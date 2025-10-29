import fs from "fs";
import path from "path";

const baseDir = path.join(process.cwd(), "auth_info"); // top-level folder

export function deleteOldSessionFiles(dir = baseDir) {
    if (!fs.existsSync(dir)) {
        console.warn("⚠️ Directory not found:", dir);
        return;
    }

    const qrFolder = path.join(dir, "qr");

    if (fs.existsSync(qrFolder)) {
        const files = fs.readdirSync(qrFolder);
        files.forEach(file => {
            if (
                file.startsWith("pre-key-") ||
                file.startsWith("session-") ||
                file.startsWith("device-list-") ||
                file.startsWith("app-state-sync-key-") ||
                file.startsWith("sender-key-status@broadcast-") ||
                file.startsWith("lid-mapping-")
            ) {
                try {
                    fs.unlinkSync(path.join(qrFolder, file));
                    // console.log("🧹 Deleted:", path.join(qrFolder, file));
                } catch (err) {
                    // console.error("❌ Error deleting file:", err.message);
                }
            }
        });
    }

    // Recurse into subdirectories (skip qr folders)
    fs.readdirSync(dir, { withFileTypes: true })
        .filter(f => f.isDirectory() && f.name !== "qr")
        .forEach(f => deleteOldSessionFiles(path.join(dir, f.name)));
}