using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace Orbit.Bridge
{
    /// <summary>
    /// Local server that lets the Orbit IDE see and drive this Unity Editor: hierarchy, inspector,
    /// live camera frames, picking, console and play controls. Listens on 127.0.0.1 only and
    /// requires the token written to Library/OrbitBridge.json.
    /// </summary>
    [InitializeOnLoad]
    internal static class OrbitBridge
    {
        private const string Version = "1.2.0";
        private const int FirstPort = 17840;
        private const int MaxLogs = 2000;
        private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;
        private static readonly ConcurrentQueue<Action> MainThread = new ConcurrentQueue<Action>();
        private static readonly List<Dictionary<string, object>> Logs = new List<Dictionary<string, object>>();
        private static readonly object LogLock = new object();
        private static readonly Regex StackLocation = new Regex(@"\(at (?<file>[^)]+?):(?<line>\d+)\)");
        private static readonly string BridgeFile = Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Library", "OrbitBridge.json");

        private static HttpListener listener;
        private static string token;
        private static int port;
        private static int logOffset;
        private static int hierarchyVersion;

        static OrbitBridge()
        {
            // Asset import workers and batch runs load editor scripts too, but have no editor loop:
            // a bridge there would grab the port and never answer.
            if (AssetDatabase.IsAssetImportWorkerProcess() || Application.isBatchMode)
            {
                return;
            }
            EditorApplication.update += Pump;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += () =>
            {
                Stop();
                try { File.Delete(BridgeFile); } catch { /* already gone */ }
            };
            EditorApplication.hierarchyChanged += () => hierarchyVersion++;
            Application.logMessageReceivedThreaded += OnLog;
            CompilationPipeline.assemblyCompilationFinished += OnCompiled;
            Start();
        }

        // --- server

        private static void Start()
        {
            // The token and port survive script reloads, so Orbit stays connected while you code.
            token = SessionState.GetString("Orbit.Bridge.Token", "");
            if (string.IsNullOrEmpty(token))
            {
                token = Guid.NewGuid().ToString("N");
                SessionState.SetString("Orbit.Bridge.Token", token);
            }
            var preferred = SessionState.GetInt("Orbit.Bridge.Port", FirstPort);
            foreach (var candidate in new[] { preferred }.Concat(Enumerable.Range(FirstPort, 20)).Distinct())
            {
                try
                {
                    var l = new HttpListener();
                    l.Prefixes.Add($"http://127.0.0.1:{candidate}/");
                    l.Start();
                    listener = l;
                    port = candidate;
                    break;
                }
                catch (Exception)
                {
                    // port taken, try the next one
                }
            }
            if (listener == null)
            {
                Debug.LogWarning("[Orbit] Could not start the bridge: no free port.");
                return;
            }
            SessionState.SetInt("Orbit.Bridge.Port", port);
            var thread = new Thread(Listen) { IsBackground = true, Name = "Orbit Bridge" };
            thread.Start(listener);
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(BridgeFile));
                File.WriteAllText(BridgeFile, OrbitJson.Write(new Dictionary<string, object>
                {
                    ["port"] = port,
                    ["token"] = token,
                    ["pid"] = System.Diagnostics.Process.GetCurrentProcess().Id,
                    ["unity"] = Application.unityVersion,
                    ["project"] = Application.productName,
                }));
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Orbit] Could not write {BridgeFile}: {e.Message}");
            }
        }

        private static void Stop()
        {
            try { listener?.Stop(); listener?.Close(); } catch { /* closing anyway */ }
            listener = null;
        }

        private static void Listen(object state)
        {
            var l = (HttpListener)state;
            while (l.IsListening)
            {
                HttpListenerContext context;
                try
                {
                    context = l.GetContext();
                }
                catch
                {
                    return; // stopped
                }
                ThreadPool.QueueUserWorkItem(_ => Handle(context));
            }
        }

        private static void Pump()
        {
            var budget = 32;
            while (budget-- > 0 && MainThread.TryDequeue(out var action))
            {
                action();
            }
        }

        private static void Handle(HttpListenerContext context)
        {
            var response = context.Response;
            response.AddHeader("Access-Control-Allow-Origin", "*");
            response.AddHeader("Cache-Control", "no-store");
            try
            {
                if (context.Request.HttpMethod == "OPTIONS")
                {
                    response.AddHeader("Access-Control-Allow-Methods", "GET, POST");
                    response.StatusCode = 204;
                    return;
                }
                var query = context.Request.QueryString;
                if (query["token"] != token)
                {
                    Send(response, 403, Error("bad token"));
                    return;
                }
                byte[] body = null;
                var contentType = "application/json; charset=utf-8";
                var status = 200;
                var done = new ManualResetEventSlim();
                // Unity's API only works on the main thread: run there, answer from here.
                MainThread.Enqueue(() =>
                {
                    try
                    {
                        var result = Route(context.Request.Url.AbsolutePath, query);
                        if (result is byte[] image)
                        {
                            body = image;
                            contentType = "image/jpeg";
                        }
                        else
                        {
                            body = Encoding.UTF8.GetBytes(OrbitJson.Write(result));
                        }
                    }
                    catch (Exception e)
                    {
                        status = e is BridgeException ? 400 : 500;
                        body = Encoding.UTF8.GetBytes(OrbitJson.Write(Error(e.Message)));
                    }
                    finally
                    {
                        done.Set();
                    }
                });
                if (!done.Wait(20000))
                {
                    Send(response, 504, Error("Unity is busy (compiling or importing)"));
                    return;
                }
                response.StatusCode = status;
                response.ContentType = contentType;
                response.OutputStream.Write(body, 0, body.Length);
            }
            catch (Exception e)
            {
                try { Send(response, 500, Error(e.Message)); } catch { /* client gone */ }
            }
            finally
            {
                try { response.Close(); } catch { /* client gone */ }
            }
        }

        private static void Send(HttpListenerResponse response, int status, object payload)
        {
            var bytes = Encoding.UTF8.GetBytes(OrbitJson.Write(payload));
            response.StatusCode = status;
            response.ContentType = "application/json; charset=utf-8";
            response.OutputStream.Write(bytes, 0, bytes.Length);
        }

        private static Dictionary<string, object> Error(string message) => new Dictionary<string, object> { ["error"] = message };

        private sealed class BridgeException : Exception
        {
            public BridgeException(string message) : base(message) { }
        }

        // --- routes

        private static object Route(string path, System.Collections.Specialized.NameValueCollection q)
        {
            switch (path)
            {
                case "/state": return State();
                case "/hierarchy": return Hierarchy();
                case "/inspect": return Inspect(Find(q["id"]));
                case "/find": return FindByName(q["q"] ?? "");
                case "/set": return SetProperty(Find(q["id"]), Int(q["comp"], -1), q["path"], q["value"] ?? "");
                case "/select":
                    var selected = Find(q["id"]);
                    Selection.activeGameObject = selected;
                    EditorGUIUtility.PingObject(selected);
                    return Ok();
                case "/focus":
                    Selection.activeGameObject = Find(q["id"]);
                    SceneView.FrameLastActiveSceneView();
                    return Ok();
                case "/frame": return Frame(q["view"], Int(q["w"], 960), Int(q["h"], 540), Int(q["q"], 85));
                case "/input": return GameInput(q);
                case "/pick": return Pick(q["view"], Float(q["x"]), Float(q["y"]), Int(q["w"], 960), Int(q["h"], 540));
                case "/create": return Create(q["name"], q["primitive"], q["parent"], q["position"]);
                case "/addComponent": return AddComponent(Find(q["id"]), q["type"]);
                case "/removeComponent": return RemoveComponent(Find(q["id"]), Int(q["comp"], -1));
                case "/delete":
                    var doomed = Find(q["id"]);
                    Undo.DestroyObjectImmediate(doomed);
                    MarkDirty();
                    return Ok();
                case "/play":
                    KeepRunning();
                    EditorApplication.isPlaying = true;
                    return Ok();
                case "/pause":
                    EditorApplication.isPaused = !EditorApplication.isPaused;
                    return Ok();
                case "/stop":
                    EditorApplication.isPlaying = false;
                    return Ok();
                case "/save": return SaveScenes();
                case "/refresh":
                    AssetDatabase.Refresh();
                    CompilationPipeline.RequestScriptCompilation();
                    return Ok();
                case "/logs": return LogsSince(Int(q["since"], 0));
                case "/clearLogs":
                    lock (LogLock) { logOffset += Logs.Count; Logs.Clear(); }
                    return Ok();
                default:
                    throw new BridgeException($"unknown route {path}");
            }
        }

        private static Dictionary<string, object> Ok() => new Dictionary<string, object> { ["ok"] = true };

        /// <summary>
        /// Saves every open scene without ever opening a dialog: a modal "Save as" would freeze the
        /// editor for everyone waiting on the bridge. Untitled scenes go to Assets/Scenes.
        /// </summary>
        private static Dictionary<string, object> SaveScenes()
        {
            if (EditorApplication.isPlaying)
            {
                throw new BridgeException("stop the game first: changes made while playing are not saved");
            }
            var saved = new List<object>();
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.isLoaded)
                {
                    continue;
                }
                var path = scene.path;
                if (string.IsNullOrEmpty(path))
                {
                    Directory.CreateDirectory(Path.Combine(Application.dataPath, "Scenes"));
                    path = AssetDatabase.GenerateUniqueAssetPath($"Assets/Scenes/{(string.IsNullOrEmpty(scene.name) ? "Main" : scene.name)}.unity");
                }
                if (!EditorSceneManager.SaveScene(scene, path))
                {
                    throw new BridgeException($"could not save {path}");
                }
                saved.Add(path);
            }
            return new Dictionary<string, object> { ["ok"] = true, ["saved"] = saved };
        }

        private static int Int(string s, int fallback) => int.TryParse(s, NumberStyles.Integer, Invariant, out var v) ? v : fallback;

        private static float Float(string s) => float.TryParse(s, NumberStyles.Float, Invariant, out var v) ? v : 0f;

        private static GameObject Find(string id)
        {
            if (!int.TryParse(id, out var instanceId))
            {
                throw new BridgeException("missing id");
            }
#pragma warning disable CS0618 // instance ids are what the editor hands out
            var obj = EditorUtility.InstanceIDToObject(instanceId);
#pragma warning restore CS0618
            return obj as GameObject ?? (obj as Component)?.gameObject ?? throw new BridgeException($"no object {id}");
        }

        private static int IdOf(Object obj)
        {
#pragma warning disable CS0618
            return obj.GetInstanceID();
#pragma warning restore CS0618
        }

        private static IEnumerable<GameObject> Roots()
        {
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (scene.isLoaded)
                {
                    foreach (var root in scene.GetRootGameObjects())
                    {
                        yield return root;
                    }
                }
            }
        }

        private static void MarkDirty()
        {
            if (!EditorApplication.isPlaying)
            {
                EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            }
        }

        // --- state and hierarchy

        private static Dictionary<string, object> State()
        {
            var scene = SceneManager.GetActiveScene();
            int logCount;
            lock (LogLock) { logCount = logOffset + Logs.Count; }
            return new Dictionary<string, object>
            {
                ["project"] = Application.productName,
                ["unity"] = Application.unityVersion,
                ["playing"] = EditorApplication.isPlaying,
                ["paused"] = EditorApplication.isPaused,
                ["compiling"] = EditorApplication.isCompiling,
                ["scene"] = scene.name,
                ["scenePath"] = scene.path,
                ["dirty"] = scene.isDirty,
                ["version"] = hierarchyVersion,
                ["selection"] = Selection.activeGameObject ? IdOf(Selection.activeGameObject) : 0,
                ["logs"] = logCount,
                ["bridge"] = Version,
                ["input"] = OrbitInput.Available,
            };
        }

        private static List<object> Hierarchy()
        {
            var budget = 4000;
            return Roots().Select(r => Node(r, 0, ref budget)).Where(n => n != null).Cast<object>().ToList();
        }

        private static Dictionary<string, object> Node(GameObject go, int depth, ref int budget)
        {
            if (budget-- <= 0)
            {
                return null;
            }
            var children = new List<object>();
            if (depth < 16)
            {
                foreach (Transform child in go.transform)
                {
                    var node = Node(child.gameObject, depth + 1, ref budget);
                    if (node != null)
                    {
                        children.Add(node);
                    }
                }
            }
            return new Dictionary<string, object>
            {
                ["id"] = IdOf(go),
                ["name"] = go.name,
                ["active"] = go.activeInHierarchy,
                ["kind"] = KindOf(go),
                ["children"] = children,
            };
        }

        private static string KindOf(GameObject go)
        {
            if (go.GetComponent<Camera>()) return "camera";
            if (go.GetComponent<Light>()) return "light";
            if (go.GetComponent<Canvas>() || go.GetComponent<RectTransform>()) return "ui";
            if (go.GetComponent<ParticleSystem>()) return "particles";
            if (go.GetComponent<AudioSource>()) return "audio";
            if (go.GetComponent<Renderer>()) return "mesh";
            if (go.GetComponents<MonoBehaviour>().Length > 0) return "script";
            return "empty";
        }

        private static List<object> FindByName(string text)
        {
            var found = new List<object>();
            void Visit(GameObject go, string path)
            {
                var full = string.IsNullOrEmpty(path) ? go.name : $"{path}/{go.name}";
                if (go.name.IndexOf(text, StringComparison.OrdinalIgnoreCase) >= 0 && found.Count < 50)
                {
                    found.Add(new Dictionary<string, object> { ["id"] = IdOf(go), ["path"] = full, ["kind"] = KindOf(go) });
                }
                foreach (Transform child in go.transform)
                {
                    Visit(child.gameObject, full);
                }
            }
            foreach (var root in Roots())
            {
                Visit(root, "");
            }
            return found;
        }

        // --- inspector

        private static string PathOf(GameObject go)
        {
            var names = new List<string>();
            for (var t = go.transform; t != null; t = t.parent)
            {
                names.Insert(0, t.name);
            }
            return string.Join("/", names);
        }

        private static Dictionary<string, object> Inspect(GameObject go)
        {
            var components = new List<object>();
            var all = go.GetComponents<Component>();
            for (var i = 0; i < all.Length; i++)
            {
                var component = all[i];
                if (component == null)
                {
                    components.Add(new Dictionary<string, object> { ["index"] = i, ["type"] = "Missing script", ["properties"] = new List<object>() });
                    continue;
                }
                string script = null;
                if (component is MonoBehaviour behaviour)
                {
                    var mono = MonoScript.FromMonoBehaviour(behaviour);
                    script = mono ? AssetDatabase.GetAssetPath(mono) : null;
                }
                var properties = new List<object>();
                var so = new SerializedObject(component);
                var it = so.GetIterator();
                var enter = true;
                while (it.NextVisible(enter) && properties.Count < 80)
                {
                    enter = false;
                    if (it.propertyPath != "m_Script")
                    {
                        properties.Add(Describe(it));
                    }
                }
                components.Add(new Dictionary<string, object>
                {
                    ["index"] = i,
                    ["type"] = component.GetType().Name,
                    ["fullType"] = component.GetType().FullName,
                    ["script"] = script,
                    ["properties"] = properties,
                });
            }
            return new Dictionary<string, object>
            {
                ["id"] = IdOf(go),
                ["name"] = go.name,
                ["path"] = PathOf(go),
                ["active"] = go.activeSelf,
                ["tag"] = go.tag,
                ["layer"] = LayerMask.LayerToName(go.layer),
                ["components"] = components,
            };
        }

        private static Dictionary<string, object> Describe(SerializedProperty p)
        {
            var d = new Dictionary<string, object>
            {
                ["path"] = p.propertyPath,
                ["label"] = p.displayName,
                ["readonly"] = !p.editable,
            };
            switch (p.propertyType)
            {
                case SerializedPropertyType.Integer:
                case SerializedPropertyType.LayerMask:
                case SerializedPropertyType.ArraySize:
                    d["kind"] = "int"; d["value"] = p.longValue; break;
                case SerializedPropertyType.Boolean:
                    d["kind"] = "bool"; d["value"] = p.boolValue; break;
                case SerializedPropertyType.Float:
                    d["kind"] = "float"; d["value"] = p.doubleValue; break;
                case SerializedPropertyType.String:
                    d["kind"] = "string"; d["value"] = p.stringValue; break;
                case SerializedPropertyType.Color:
                    var c = p.colorValue;
                    d["kind"] = "color"; d["value"] = new List<object> { c.r, c.g, c.b, c.a }; break;
                case SerializedPropertyType.Vector2:
                    d["kind"] = "vector"; d["value"] = new List<object> { p.vector2Value.x, p.vector2Value.y }; break;
                case SerializedPropertyType.Vector3:
                    d["kind"] = "vector"; d["value"] = new List<object> { p.vector3Value.x, p.vector3Value.y, p.vector3Value.z }; break;
                case SerializedPropertyType.Vector4:
                    d["kind"] = "vector"; d["value"] = new List<object> { p.vector4Value.x, p.vector4Value.y, p.vector4Value.z, p.vector4Value.w }; break;
                case SerializedPropertyType.Vector2Int:
                    d["kind"] = "vector"; d["value"] = new List<object> { p.vector2IntValue.x, p.vector2IntValue.y }; break;
                case SerializedPropertyType.Vector3Int:
                    d["kind"] = "vector"; d["value"] = new List<object> { p.vector3IntValue.x, p.vector3IntValue.y, p.vector3IntValue.z }; break;
                case SerializedPropertyType.Quaternion:
                    var e = p.quaternionValue.eulerAngles;
                    d["kind"] = "rotation"; d["value"] = new List<object> { Round(e.x), Round(e.y), Round(e.z) }; break;
                case SerializedPropertyType.Enum:
                    d["kind"] = "enum"; d["value"] = p.enumValueIndex; d["options"] = p.enumDisplayNames.ToList(); break;
                case SerializedPropertyType.ObjectReference:
                    var o = p.objectReferenceValue;
                    d["kind"] = "object"; d["value"] = o ? $"{o.name} ({o.GetType().Name})" : null; d["readonly"] = true; break;
                default:
                    d["kind"] = "other"; d["value"] = p.isArray ? $"{p.arraySize} éléments" : p.propertyType.ToString(); d["readonly"] = true; break;
            }
            return d;
        }

        private static float Round(float v) => (float)Math.Round(v, 3);

        private static float[] Numbers(string value) => value.Split(',').Select(s => float.Parse(s.Trim(), NumberStyles.Float, Invariant)).ToArray();

        private static Dictionary<string, object> SetProperty(GameObject go, int componentIndex, string path, string value)
        {
            Object target = componentIndex < 0 ? go : go.GetComponents<Component>().ElementAtOrDefault(componentIndex);
            if (target == null)
            {
                throw new BridgeException("no such component");
            }
            var so = new SerializedObject(target);
            var p = so.FindProperty(path) ?? throw new BridgeException($"no property {path}");
            switch (p.propertyType)
            {
                case SerializedPropertyType.Integer:
                case SerializedPropertyType.LayerMask:
                    p.longValue = long.Parse(value, Invariant); break;
                case SerializedPropertyType.Boolean:
                    p.boolValue = value == "true" || value == "1"; break;
                case SerializedPropertyType.Float:
                    p.doubleValue = double.Parse(value, NumberStyles.Float, Invariant); break;
                case SerializedPropertyType.String:
                    p.stringValue = value; break;
                case SerializedPropertyType.Color:
                    var c = Numbers(value);
                    p.colorValue = new Color(c[0], c[1], c[2], c.Length > 3 ? c[3] : 1f); break;
                case SerializedPropertyType.Vector2:
                    var v2 = Numbers(value); p.vector2Value = new Vector2(v2[0], v2[1]); break;
                case SerializedPropertyType.Vector3:
                    var v3 = Numbers(value); p.vector3Value = new Vector3(v3[0], v3[1], v3[2]); break;
                case SerializedPropertyType.Vector4:
                    var v4 = Numbers(value); p.vector4Value = new Vector4(v4[0], v4[1], v4[2], v4[3]); break;
                case SerializedPropertyType.Vector2Int:
                    var i2 = Numbers(value); p.vector2IntValue = new Vector2Int((int)i2[0], (int)i2[1]); break;
                case SerializedPropertyType.Vector3Int:
                    var i3 = Numbers(value); p.vector3IntValue = new Vector3Int((int)i3[0], (int)i3[1], (int)i3[2]); break;
                case SerializedPropertyType.Quaternion:
                    var r = Numbers(value); p.quaternionValue = Quaternion.Euler(r[0], r[1], r[2]); break;
                case SerializedPropertyType.Enum:
                    p.enumValueIndex = int.Parse(value, Invariant); break;
                default:
                    throw new BridgeException($"{p.propertyType} can't be edited from Orbit");
            }
            so.ApplyModifiedProperties();
            MarkDirty();
            return Ok();
        }

        // --- creating and changing objects

        private static Dictionary<string, object> Create(string name, string primitive, string parentId, string position)
        {
            GameObject go;
            if (string.IsNullOrEmpty(primitive) || primitive.Equals("Empty", StringComparison.OrdinalIgnoreCase))
            {
                go = new GameObject(string.IsNullOrEmpty(name) ? "GameObject" : name);
            }
            else
            {
                if (!Enum.TryParse(primitive, true, out PrimitiveType type))
                {
                    throw new BridgeException($"unknown primitive {primitive} (Cube, Sphere, Capsule, Cylinder, Plane, Quad, Empty)");
                }
                go = GameObject.CreatePrimitive(type);
                if (!string.IsNullOrEmpty(name))
                {
                    go.name = name;
                }
            }
            if (!string.IsNullOrEmpty(parentId))
            {
                go.transform.SetParent(Find(parentId).transform, false);
            }
            if (!string.IsNullOrEmpty(position))
            {
                var p = Numbers(position);
                go.transform.localPosition = new Vector3(p[0], p[1], p[2]);
            }
            Undo.RegisterCreatedObjectUndo(go, "Orbit: create object");
            Selection.activeGameObject = go;
            MarkDirty();
            return new Dictionary<string, object> { ["id"] = IdOf(go), ["path"] = PathOf(go) };
        }

        private static Dictionary<string, object> AddComponent(GameObject go, string typeName)
        {
            var type = TypeCache.GetTypesDerivedFrom<Component>()
                .Where(t => !t.IsAbstract && (t.Name == typeName || t.FullName == typeName))
                .OrderBy(t => t.Namespace == "UnityEngine" ? 0 : 1)
                .FirstOrDefault() ?? throw new BridgeException($"unknown component {typeName}");
            var added = Undo.AddComponent(go, type) ?? throw new BridgeException($"Unity refused to add {typeName}");
            MarkDirty();
            return new Dictionary<string, object> { ["ok"] = true, ["index"] = Array.IndexOf(go.GetComponents<Component>(), added) };
        }

        private static Dictionary<string, object> RemoveComponent(GameObject go, int index)
        {
            var component = go.GetComponents<Component>().ElementAtOrDefault(index);
            if (component == null || component is Transform)
            {
                throw new BridgeException("this component can't be removed");
            }
            Undo.DestroyObjectImmediate(component);
            MarkDirty();
            return Ok();
        }

        // --- seeing the game

        private static Camera CameraFor(string view)
        {
            if (view == "scene" && SceneView.lastActiveSceneView != null)
            {
                return SceneView.lastActiveSceneView.camera;
            }
            if (Camera.main)
            {
                return Camera.main;
            }
            return Object.FindObjectsByType<Camera>(FindObjectsSortMode.None).FirstOrDefault(c => c.enabled && c.gameObject.activeInHierarchy)
                ?? throw new BridgeException("no camera in the scene");
        }

        private static byte[] Frame(string view, int width, int height, int quality)
        {
            width = Mathf.Clamp(width, 64, 2048);
            height = Mathf.Clamp(height, 64, 2048);
            var cam = CameraFor(view);
            var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var previousTarget = cam.targetTexture;
            var previousActive = RenderTexture.active;
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false);
            try
            {
                cam.targetTexture = rt;
                cam.Render();
                RenderTexture.active = rt;
                texture.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                texture.Apply();
                return texture.EncodeToJPG(Mathf.Clamp(quality, 30, 95));
            }
            finally
            {
                cam.targetTexture = previousTarget;
                cam.ResetAspect();
                RenderTexture.active = previousActive;
                RenderTexture.ReleaseTemporary(rt);
                Object.DestroyImmediate(texture);
            }
        }

        /// <summary>What lies under a point of a frame (x and y from 0 to 1, top left origin).</summary>
        private static Dictionary<string, object> Pick(string view, float x, float y, int width, int height)
        {
            var cam = CameraFor(view);
            cam.aspect = width / (float)height;
            var ray = cam.ViewportPointToRay(new Vector3(x, 1f - y, 0f));
            cam.ResetAspect();
            GameObject hit = null;
            if (Physics.Raycast(ray, out var hit3d, 100000f))
            {
                hit = hit3d.collider.gameObject;
            }
            else
            {
                var hit2d = Physics2D.GetRayIntersection(ray);
                if (hit2d.collider)
                {
                    hit = hit2d.collider.gameObject;
                }
                else
                {
                    // Objects without colliders: nearest renderer whose bounds the ray crosses.
                    var best = float.MaxValue;
                    foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))
                    {
                        if (r.enabled && r.gameObject.activeInHierarchy && r.bounds.IntersectRay(ray, out var distance) && distance < best)
                        {
                            best = distance;
                            hit = r.gameObject;
                        }
                    }
                }
            }
            if (hit != null)
            {
                Selection.activeGameObject = hit;
            }
            return new Dictionary<string, object> { ["id"] = hit ? IdOf(hit) : 0, ["path"] = hit ? PathOf(hit) : null };
        }

        // --- playing from Orbit

        /// <summary>
        /// A game played from Orbit runs while Unity is in the background: without "Run In Background"
        /// the editor freezes the game as soon as another window has the focus.
        /// </summary>
        private static void KeepRunning()
        {
            if (!PlayerSettings.runInBackground)
            {
                PlayerSettings.runInBackground = true;
            }
            Application.runInBackground = true;
        }

        private static Dictionary<string, object> GameInput(System.Collections.Specialized.NameValueCollection q)
        {
            if (!EditorApplication.isPlaying)
            {
                throw new BridgeException("the game is not playing");
            }
            if (!OrbitInput.Available)
            {
                throw new BridgeException("this game reads the legacy Input class: it needs the Input System package (1.4 or newer) to be played from Orbit");
            }
            KeepRunning();
            if (q["release"] == "1")
            {
                OrbitInput.Release();
            }
            else
            {
                OrbitInput.Apply(q["keys"], Int(q["buttons"], 0), Float(q["x"]), Float(q["y"]), Float(q["dx"]), Float(q["dy"]), Float(q["scroll"]));
            }
            return Ok();
        }

        // --- console

        private static void OnLog(string message, string stack, LogType type)
        {
            var match = StackLocation.Match(stack ?? "");
            Add(new Dictionary<string, object>
            {
                ["type"] = type == LogType.Warning ? "warning" : type == LogType.Log ? "log" : "error",
                ["message"] = message,
                ["stack"] = stack ?? "",
                ["file"] = match.Success ? match.Groups["file"].Value : null,
                ["line"] = match.Success ? int.Parse(match.Groups["line"].Value, Invariant) : 0,
            });
        }

        private static void OnCompiled(string assembly, CompilerMessage[] messages)
        {
            foreach (var m in messages.Where(m => m.type == CompilerMessageType.Error))
            {
                Add(new Dictionary<string, object>
                {
                    ["type"] = "error",
                    ["compile"] = true,
                    ["message"] = m.message,
                    ["stack"] = "",
                    ["file"] = m.file,
                    ["line"] = m.line,
                });
            }
        }

        private static void Add(Dictionary<string, object> entry)
        {
            lock (LogLock)
            {
                entry["index"] = logOffset + Logs.Count;
                entry["time"] = DateTime.Now.ToString("HH:mm:ss", Invariant);
                Logs.Add(entry);
                if (Logs.Count > MaxLogs)
                {
                    Logs.RemoveRange(0, Logs.Count - MaxLogs);
                    logOffset = (int)Logs[0]["index"];
                }
            }
        }

        private static Dictionary<string, object> LogsSince(int since)
        {
            lock (LogLock)
            {
                return new Dictionary<string, object>
                {
                    ["total"] = logOffset + Logs.Count,
                    ["entries"] = Logs.Where(l => (int)l["index"] >= since).Take(500).ToList(),
                };
            }
        }
    }
}
