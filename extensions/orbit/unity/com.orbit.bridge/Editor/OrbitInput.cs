using System;
using UnityEditor;
using UnityEngine;
#if ORBIT_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
#endif

namespace Orbit.Bridge
{
    /// <summary>
    /// Playing the game from Orbit: the keys and the mouse held in Orbit's game view are fed to the
    /// game through two virtual Input System devices. Unity is not the focused application then,
    /// so the Input System is told to keep listening for as long as Orbit plays.
    /// Needs the Input System package (1.4 or newer). The legacy Input class cannot be fed from
    /// outside (queueing game view events, window messages and game view focus were all tried).
    /// </summary>
    internal static class OrbitInput
    {
#if ORBIT_INPUT_SYSTEM
        private const string KeyboardName = "Orbit Keyboard";
        private const string MouseName = "Orbit Mouse";
        private const string BackgroundKey = "Orbit.Input.Background";
        private const string EditorKey = "Orbit.Input.Editor";

        private static bool watching;

        public static bool Available => true;

        public static void Apply(string keys, int buttons, float x, float y, float dx, float dy, float scroll)
        {
            Capture(out var keyboard, out var mouse);
            // The player only takes input while the game view "has the focus": say so, as the game
            // view itself does when it is clicked. Without this the events are dropped (verified).
            UnityEditorInternal.InternalEditorUtility.OnGameViewFocus(true);

            var keyboardState = new KeyboardState();
            foreach (var name in (keys ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (Enum.TryParse<Key>(name, out var key) && key != Key.None)
                {
                    keyboardState.Set(key, true);
                }
            }
            InputSystem.QueueStateEvent(keyboard, keyboardState);

            var size = Handles.GetMainGameViewSize();
            var mouseState = new MouseState
            {
                position = new Vector2(Mathf.Clamp01(x) * size.x, (1f - Mathf.Clamp01(y)) * size.y),
                delta = new Vector2(dx, -dy),
                scroll = new Vector2(0f, scroll),
            }
                .WithButton(MouseButton.Left, (buttons & 1) != 0)
                .WithButton(MouseButton.Right, (buttons & 2) != 0)
                .WithButton(MouseButton.Middle, (buttons & 4) != 0);
            InputSystem.QueueStateEvent(mouse, mouseState);
        }

        /// <summary>Lets go of every key and hands the input settings back as they were.</summary>
        public static void Release()
        {
            if (InputSystem.GetDevice(KeyboardName) is Keyboard keyboard)
            {
                InputSystem.QueueStateEvent(keyboard, new KeyboardState());
                InputSystem.RemoveDevice(keyboard);
            }
            if (InputSystem.GetDevice(MouseName) is Mouse mouse)
            {
                InputSystem.RemoveDevice(mouse);
            }
            var background = SessionState.GetInt(BackgroundKey, -1);
            var editor = SessionState.GetInt(EditorKey, -1);
            if (background >= 0)
            {
                InputSystem.settings.backgroundBehavior = (InputSettings.BackgroundBehavior)background;
                SessionState.EraseInt(BackgroundKey);
            }
            if (editor >= 0)
            {
                InputSystem.settings.editorInputBehaviorInPlayMode = (InputSettings.EditorInputBehaviorInPlayMode)editor;
                SessionState.EraseInt(EditorKey);
            }
        }

        private static void Capture(out Keyboard keyboard, out Mouse mouse)
        {
            // Looked up by name: the devices outlive a script reload, this class's fields do not.
            keyboard = InputSystem.GetDevice(KeyboardName) as Keyboard ?? InputSystem.AddDevice<Keyboard>(KeyboardName);
            mouse = InputSystem.GetDevice(MouseName) as Mouse ?? InputSystem.AddDevice<Mouse>(MouseName);
            if (SessionState.GetInt(BackgroundKey, -1) < 0)
            {
                SessionState.SetInt(BackgroundKey, (int)InputSystem.settings.backgroundBehavior);
                SessionState.SetInt(EditorKey, (int)InputSystem.settings.editorInputBehaviorInPlayMode);
            }
            // Orbit has the focus, not Unity: without these the game would be deaf.
            InputSystem.settings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
            InputSystem.settings.editorInputBehaviorInPlayMode = InputSettings.EditorInputBehaviorInPlayMode.AllDeviceInputAlwaysGoesToGameView;
            if (!watching)
            {
                watching = true;
                EditorApplication.playModeStateChanged += change =>
                {
                    if (change == PlayModeStateChange.ExitingPlayMode)
                    {
                        Release();
                    }
                };
            }
        }
#else
        public static bool Available => false;

        public static void Apply(string keys, int buttons, float x, float y, float dx, float dy, float scroll) { }

        public static void Release() { }
#endif
    }
}
