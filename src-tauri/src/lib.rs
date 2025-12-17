#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
#[cfg(target_os = "macos")]
use cocoa::appkit::{NSColor, NSWindow};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};
#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventTapLocation, CGKeyCode};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

use tauri::menu::{MenuBuilder, MenuId, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use std::collections::HashMap;
use std::sync::Mutex;

use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::Path;

fn log_line(msg: &str) {
    println!("[magic-control] {}", msg);
    if let Ok(home) = std::env::var("HOME") {
        let dir = format!("{}/Library/Logs/MagicControl", home);
        let file = format!("{}/magic-control.log", dir);
        let _ = create_dir_all(Path::new(&dir));
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(file) {
            let _ = writeln!(f, "{}", msg);
        }
    }
}

#[tauri::command]
fn set_click_through(window: tauri::Window, ignore: bool) {
    log_line(&format!("set_click_through ignore={}", ignore));
    let _ = window.set_ignore_cursor_events(ignore);
}

// 状态菜单项的全局引用
struct TrayState {
    status_item: Option<MenuItem<tauri::Wry>>,
}

#[tauri::command]
fn update_tray_status(app: AppHandle, status: String) {
    log_line(&format!("update_tray_status: {}", status));
    if let Some(state) = app.try_state::<Mutex<TrayState>>() {
        if let Ok(guard) = state.lock() {
            if let Some(ref item) = guard.status_item {
                let _ = item.set_text(&status);
            }
        }
    }
}

#[tauri::command]
fn press_key(direction: String) -> Result<(), String> {
    log_line(&format!("press_key {}", direction));
    #[cfg(target_os = "macos")]
    {
        let keycode: CGKeyCode = match direction.as_str() {
            "right" => 124, // kVK_RightArrow
            "left" => 123,  // kVK_LeftArrow
            _ => return Err("unknown direction".into()),
        };

        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| "event source failed")?;
        let key_down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
            .map_err(|_| "key down failed")?;
        let key_up =
            CGEvent::new_keyboard_event(source, keycode, false).map_err(|_| "key up failed")?;
        key_down.post(CGEventTapLocation::HID);
        key_up.post(CGEventTapLocation::HID);
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("unsupported platform".into())
    }
}

fn setup_tray(app: &AppHandle) -> Result<MenuItem<tauri::Wry>, Box<dyn std::error::Error>> {
    use tauri::menu::{CheckMenuItemBuilder, SubmenuBuilder};

    // 模式菜单项
    let mode_laser = CheckMenuItemBuilder::with_id("mode_laser", "激光笔模式")
        .checked(true)
        .build(app)?;
    let mode_off = CheckMenuItemBuilder::with_id("mode_off", "关闭显示")
        .checked(false)
        .build(app)?;

    let mode_submenu = SubmenuBuilder::with_id(app, "mode_menu", "显示模式")
        .items(&[&mode_laser, &mode_off])
        .build()?;

    // 光标大小子菜单
    let size_small = CheckMenuItemBuilder::with_id("size_small", "小 (5px)")
        .checked(true) // 默认小
        .build(app)?;
    let size_mid = CheckMenuItemBuilder::with_id("size_mid", "中 (10px)")
        .checked(false)
        .build(app)?;
    let size_large = CheckMenuItemBuilder::with_id("size_large", "大 (15px)")
        .checked(false)
        .build(app)?;
    let size_submenu = SubmenuBuilder::with_id(app, "size_menu", "光标大小")
        .items(&[&size_small, &size_mid, &size_large])
        .build()?;

    // 灵敏度菜单项 (调整数值: 0.02, 0.04, 0.07)
    let sens_low = CheckMenuItemBuilder::with_id("sens_low", "低 (难触发 0.02)")
        .checked(false)
        .build(app)?;
    let sens_mid = CheckMenuItemBuilder::with_id("sens_mid", "中 (默认 0.04)")
        .checked(true)
        .build(app)?;
    let sens_high = CheckMenuItemBuilder::with_id("sens_high", "高 (易触发 0.07)")
        .checked(false)
        .build(app)?;

    let sens_submenu = SubmenuBuilder::with_id(app, "sens_menu", "翻页灵敏度")
        .items(&[&sens_low, &sens_mid, &sens_high])
        .build()?;

    // 长按菜单已移除

    // 视觉反馈菜单项
    let feedback_dot = CheckMenuItemBuilder::with_id("feedback_dot", "显示捏合绿点")
        .checked(true)
        .build(app)?;
    let feedback_toast = CheckMenuItemBuilder::with_id("feedback_toast", "显示操作文字")
        .checked(true)
        .build(app)?;

    let feedback_submenu = SubmenuBuilder::with_id(app, "feedback_menu", "视觉反馈")
        .items(&[&feedback_dot, &feedback_toast])
        .build()?;

    // 状态和退出
    let status = MenuItemBuilder::with_id("status", "状态: 等待检测...")
        .enabled(false)
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出 Magic Control").build(app)?;

    // 构建菜单
    let menu = MenuBuilder::new(app)
        .item(&status)
        .separator()
        .item(&mode_submenu)
        .item(&size_submenu)
        .item(&sens_submenu)
        .item(&feedback_submenu)
        .separator()
        .item(&quit)
        .build()?;

    // 克隆句柄以供事件处理闭包使用
    let m_laser = mode_laser.clone();
    let m_off = mode_off.clone();

    let sz_small = size_small.clone();
    let sz_mid = size_mid.clone();
    let sz_large = size_large.clone();

    let s_low = sens_low.clone();
    let s_mid = sens_mid.clone();
    let s_high = sens_high.clone();

    let fb_dot = feedback_dot.clone();
    let fb_toast = feedback_toast.clone();

    let app_handle = app.clone();
    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            log_line(&format!("Menu clicked: {}", id));

            match id {
                "quit" => app.exit(0),

                // --- 视觉反馈 ---
                "feedback_dot" => {
                    let is_checked = fb_dot.is_checked().unwrap_or(false);
                    log_line(&format!("Toggle Dot: current (post-click)={}", is_checked));

                    // macOS has already toggled the visual state, so 'is_checked' IS the new state we want.
                    // We just accept it and emit it.
                    let new_state = is_checked;

                    if let Err(e) = app.emit("set_feedback_dot", new_state) {
                        log_line(&format!("Failed to emit dot event: {}", e));
                    } else {
                        log_line(&format!("Emitted set_feedback_dot: {}", new_state));
                    }
                }
                "feedback_toast" => {
                    let is_checked = fb_toast.is_checked().unwrap_or(false);
                    log_line(&format!(
                        "Toggle Toast: current (post-click)={}",
                        is_checked
                    ));

                    let new_state = is_checked;
                    let _ = app.emit("set_feedback_toast", new_state);
                }

                // --- 模式切换 ---
                "mode_laser" => {
                    let _ = m_laser.set_checked(true);
                    let _ = m_off.set_checked(false);
                    let _ = app.emit("set_mode", "laser");
                }
                "mode_off" => {
                    let _ = m_laser.set_checked(false);
                    let _ = m_off.set_checked(true);
                    let _ = app.emit("set_mode", "off");
                }

                // --- 光标大小 ---
                "size_small" => {
                    let _ = sz_small.set_checked(true);
                    let _ = sz_mid.set_checked(false);
                    let _ = sz_large.set_checked(false);
                    let _ = app.emit("set_pointer_size", 5.0);
                }
                "size_mid" => {
                    let _ = sz_small.set_checked(false);
                    let _ = sz_mid.set_checked(true);
                    let _ = sz_large.set_checked(false);
                    let _ = app.emit("set_pointer_size", 10.0);
                }
                "size_large" => {
                    let _ = sz_small.set_checked(false);
                    let _ = sz_mid.set_checked(false);
                    let _ = sz_large.set_checked(true);
                    let _ = app.emit("set_pointer_size", 15.0);
                }

                // --- 灵敏度 ---
                "sens_low" => {
                    let _ = s_low.set_checked(true);
                    let _ = s_mid.set_checked(false);
                    let _ = s_high.set_checked(false);
                    let _ = app.emit("set_sensitivity", 0.02);
                }
                "sens_mid" => {
                    let _ = s_low.set_checked(false);
                    let _ = s_mid.set_checked(true);
                    let _ = s_high.set_checked(false);
                    let _ = app.emit("set_sensitivity", 0.04);
                }
                "sens_high" => {
                    let _ = s_low.set_checked(false);
                    let _ = s_mid.set_checked(false);
                    let _ = s_high.set_checked(true);
                    let _ = app.emit("set_sensitivity", 0.07);
                }

                _ => {}
            }
        })
        .on_tray_icon_event(|_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                log_line("Tray icon clicked");
            }
        })
        .build(&app_handle)?;

    Ok(status)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("Failed to get main window");

            // Setup window size to fill screen
            if let Some(monitor) = window.current_monitor()? {
                let size = monitor.size();
                window.set_size(*size)?;
                window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: 0,
                    y: 0,
                }))?;
            }

            // Disable cursor event interception by default for debugging
            let _ = window.set_ignore_cursor_events(false);
            log_line("setup: window ignore cursor events=FALSE (Debug mode)");

            #[cfg(target_os = "macos")]
            unsafe {
                let ns_win = window.ns_window()? as id;
                ns_win.setOpaque_(false);
                ns_win.setBackgroundColor_(NSColor::clearColor(nil));
                ns_win.setHasShadow_(false);

                let ns_app = NSApp();
                ns_app.setActivationPolicy_(
                    NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory,
                );
                log_line("setup: activation policy accessory (tray only)");
            }

            // Setup system tray
            let status_item = setup_tray(app.handle())?;
            app.manage(Mutex::new(TrayState {
                status_item: Some(status_item),
            }));

            log_line("Magic Control v2 started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            press_key,
            update_tray_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
