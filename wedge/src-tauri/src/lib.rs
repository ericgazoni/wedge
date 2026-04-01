use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, LogicalSize, Manager, Size, WindowEvent};

const WINDOW_STATE_FILE: &str = "window-state.json";
const MIN_WINDOW_WIDTH: f64 = 900.0;
const MIN_WINDOW_HEIGHT: f64 = 600.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredWindowState {
    width: f64,
    height: f64,
}

fn window_state_path(app: &AppHandle) -> Option<PathBuf> {
    let base = app.path().app_config_dir().ok()?;
    Some(base.join(WINDOW_STATE_FILE))
}

fn load_window_size(app: &AppHandle) -> Option<StoredWindowState> {
    let path = window_state_path(app)?;
    let raw = fs::read_to_string(path).ok()?;
    let state = serde_json::from_str::<StoredWindowState>(&raw).ok()?;
    Some(StoredWindowState {
        width: state.width.max(MIN_WINDOW_WIDTH),
        height: state.height.max(MIN_WINDOW_HEIGHT),
    })
}

fn persist_window_size(app: &AppHandle, width: f64, height: f64) {
    let Some(path) = window_state_path(app) else {
        return;
    };

    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }

    let state = StoredWindowState {
        width: width.max(MIN_WINDOW_WIDTH),
        height: height.max(MIN_WINDOW_HEIGHT),
    };

    if let Ok(serialized) = serde_json::to_string(&state) {
        let _ = fs::write(path, serialized);
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            if let Some(main_window) = app.get_webview_window("main") {
                if let Some(state) = load_window_size(&app.handle().clone()) {
                    let _ = main_window.set_size(Size::Logical(LogicalSize {
                        width: state.width,
                        height: state.height,
                    }));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::Resized(size) = event {
                let app_handle = window.app_handle();
                persist_window_size(&app_handle, size.width as f64, size.height as f64);
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
