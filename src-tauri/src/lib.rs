use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Size, WindowEvent};

mod git_support;

const WINDOW_STATE_FILE: &str = "window-state.json";
const MIN_WINDOW_WIDTH: f64 = 900.0;
const MIN_WINDOW_HEIGHT: f64 = 600.0;
const APP_MENU_EVENT_NAME: &str = "wedge://menu-action";
const MENU_OPEN_REMOTE_REPOSITORY_ID: &str = "menu.open_remote_repository";
const MENU_CONFIGURE_GIT_SETTINGS_ID: &str = "menu.configure_git_settings";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppMenuAction {
    action: String,
}

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

fn build_app_menu<R: tauri::Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let git_menu = SubmenuBuilder::new(app, "Git")
        .text(MENU_OPEN_REMOTE_REPOSITORY_ID, "Open Remote Repository...")
        .text(MENU_CONFIGURE_GIT_SETTINGS_ID, "Configure Git Settings...")
        .build()?;
    menu.append(&git_menu)?;
    Ok(menu)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_app_menu)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
        .on_menu_event(|app, event| {
            let action = match event.id().as_ref() {
                MENU_OPEN_REMOTE_REPOSITORY_ID => Some("open-remote-repository"),
                MENU_CONFIGURE_GIT_SETTINGS_ID => Some("configure-git-settings"),
                _ => None,
            };

            if let Some(action) = action {
                let _ = app.emit(
                    APP_MENU_EVENT_NAME,
                    AppMenuAction {
                        action: action.to_string(),
                    },
                );
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            git_support::git_clone_project,
            git_support::git_get_status,
            git_support::git_get_origin_host,
            git_support::git_startup_refresh,
            git_support::git_sync,
            git_support::git_resolve_conflict
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
