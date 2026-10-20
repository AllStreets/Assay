// Assay's Mac shell: starts the engine as a sidecar and shows its UI in the system WebKit
// view. The same UI works in any browser at http://127.0.0.1:4720 when run from source.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, Url};

const PORT: u16 = 4720;

struct Engine(Mutex<Option<Child>>);

fn engine_up() -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_millis(200)).is_ok()
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            // Reuse an engine that is already running (for example `npm run dev`).
            if !engine_up() {
                let exe = std::env::current_exe()?;
                let dir = exe.parent().expect("app binary has a parent folder");
                let dist = app.path().resource_dir()?.join("dist");
                let child = Command::new(dir.join("assay-engine"))
                    .env("ASSAY_PORT", PORT.to_string())
                    .env("ASSAY_DIST", dist)
                    .env("ASSAY_APP", "1")
                    .spawn()?;
                *app.state::<Engine>().0.lock().unwrap() = Some(child);
            }
            let window = app.get_webview_window("main").expect("main window exists");
            thread::spawn(move || {
                let start = Instant::now();
                while !engine_up() && start.elapsed() < Duration::from_secs(20) {
                    thread::sleep(Duration::from_millis(100));
                }
                let _ = window.navigate(Url::parse(&format!("http://127.0.0.1:{PORT}/")).unwrap());
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Assay");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Engine>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
