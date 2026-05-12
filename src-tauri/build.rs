fn main() {
    // When the doorstop sidecar hasn't been built yet (e.g. in dev or CI without
    // Python available), create a 0-byte placeholder so tauri-build's externalBin
    // path validation passes. The runtime code handles a missing/broken binary
    // gracefully by returning available: false.
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let binaries_dir = manifest_dir.join("binaries");
    if let Ok(target) = std::env::var("TARGET") {
        if !target.is_empty() {
            let sidecar = binaries_dir.join(format!("doorstop-{}", target));
            if !sidecar.exists() {
                let _ = std::fs::create_dir_all(&binaries_dir);
                let _ = std::fs::write(&sidecar, b"");
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(meta) = std::fs::metadata(&sidecar) {
                        let mut perms = meta.permissions();
                        perms.set_mode(0o755);
                        let _ = std::fs::set_permissions(&sidecar, perms);
                    }
                }
            }
        }
    }

    tauri_build::build()
}
