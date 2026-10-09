/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The only player settings NovaGame decides: Unity fills in every other field with its defaults.
 * `activeInputHandler: 2` turns on both input back ends up front; without it Unity opens a modal
 * dialog (and restarts) the first time it sees the Input System package.
 */
export function projectSettings(name: string): string {
	return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!129 &1
PlayerSettings:
  m_ObjectHideFlags: 0
  companyName: NovaGame
  productName: ${name.replace(/[:#\n\r]/g, ' ')}
  runInBackground: 1
  activeInputHandler: 2
`;
}

/** First-person controller of the sandbox: move, look, jump, sprint. Reads the Input System. */
export const PLAYER_SCRIPT = `using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>Joueur du bac à sable : ZQSD ou WASD pour bouger, souris pour regarder, Espace pour sauter, Maj pour courir.</summary>
[RequireComponent(typeof(CharacterController))]
public class NovaPlayer : MonoBehaviour
{
    public float speed = 6f;
    public float sprint = 10f;
    public float jumpHeight = 1.4f;
    public float sensitivity = 0.12f;
    public Transform view;

    private CharacterController body;
    private float pitch;
    private float fall;

    private void Awake()
    {
        body = GetComponent<CharacterController>();
    }

    private void Update()
    {
        var keyboard = Keyboard.current;
        var mouse = Mouse.current;
        if (keyboard == null)
        {
            return;
        }

        if (mouse != null && view != null)
        {
            var look = mouse.delta.ReadValue() * sensitivity;
            transform.Rotate(0f, look.x, 0f);
            pitch = Mathf.Clamp(pitch - look.y, -85f, 85f);
            view.localRotation = Quaternion.Euler(pitch, 0f, 0f);
        }

        // Touches physiques : la rangée ZQSD d'un clavier AZERTY, WASD d'un QWERTY.
        var side = (keyboard.dKey.isPressed ? 1f : 0f) - (keyboard.aKey.isPressed ? 1f : 0f);
        var forward = (keyboard.wKey.isPressed ? 1f : 0f) - (keyboard.sKey.isPressed ? 1f : 0f);
        var move = Vector3.ClampMagnitude(transform.right * side + transform.forward * forward, 1f);
        move *= keyboard.leftShiftKey.isPressed ? sprint : speed;

        if (body.isGrounded)
        {
            fall = keyboard.spaceKey.wasPressedThisFrame ? Mathf.Sqrt(2f * jumpHeight * -Physics.gravity.y) : -1f;
        }
        fall += Physics.gravity.y * Time.deltaTime;
        body.Move((move + Vector3.up * fall) * Time.deltaTime);
    }
}
`;

/** Builds the sandbox's first scene the first time Unity opens the project: a place to play at once. */
export const STARTER_SCRIPT = `using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>Bac à sable NovaGame : crée la scène de départ une seule fois, à la première ouverture.</summary>
[InitializeOnLoad]
internal static class NovaGameStarter
{
    private const string ScenePath = "Assets/Scenes/BacASable.unity";

    static NovaGameStarter()
    {
        EditorApplication.delayCall += Build;
    }

    private static void Build()
    {
        if (Application.isBatchMode || File.Exists(ScenePath) || EditorApplication.isPlayingOrWillChangePlaymode)
        {
            return;
        }
        var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
        Directory.CreateDirectory("Assets/Materials");

        var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "Sol";
        ground.transform.localScale = new Vector3(6f, 1f, 6f);
        ground.GetComponent<Renderer>().sharedMaterial = Material("Sol", new Color(0.16f, 0.15f, 0.24f));

        var colors = new[] { new Color(0.55f, 0.48f, 1f), new Color(0.37f, 0.92f, 0.83f), new Color(1f, 0.55f, 0.35f), new Color(1f, 0.82f, 0.3f) };
        for (var i = 0; i < 8; i++)
        {
            var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.name = "Caisse " + (i + 1);
            box.transform.position = new Vector3((i % 4 - 1.5f) * 1.6f, 0.5f + i / 4 * 1.05f, 4f);
            box.AddComponent<Rigidbody>();
            box.GetComponent<Renderer>().sharedMaterial = Material("Caisse " + (i % colors.Length + 1), colors[i % colors.Length]);
        }

        var player = new GameObject("Joueur");
        player.transform.position = new Vector3(0f, 1.1f, -5f);
        var controller = player.AddComponent<CharacterController>();
        controller.height = 1.8f;
        controller.center = Vector3.zero;
        var script = player.AddComponent<NovaPlayer>();
        var camera = Camera.main;
        if (camera != null)
        {
            camera.transform.SetParent(player.transform, false);
            camera.transform.localPosition = new Vector3(0f, 0.7f, 0f);
            camera.transform.localRotation = Quaternion.identity;
            script.view = camera.transform;
        }

        Directory.CreateDirectory("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
    }

    private static Material Material(string name, Color color)
    {
        var path = "Assets/Materials/" + name + ".mat";
        var material = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (material == null)
        {
            material = new Material(Shader.Find("Standard")) { color = color };
            AssetDatabase.CreateAsset(material, path);
        }
        return material;
    }
}
`;
