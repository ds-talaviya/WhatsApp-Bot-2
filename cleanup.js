
import fs from "fs";
import path from "path";

const baseDir = path.join(process.cwd(), "auth_info"); // change path if needed

function deleteOldSessionFiles(dir) {
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
                fs.unlinkSync(path.join(qrFolder, file));
                console.log("🧹 Deleted:", path.join(qrFolder, file));
            }
        });
    }

    // recurse into subdirectories
    fs.readdirSync(dir, { withFileTypes: true })
        .filter(f => f.isDirectory() && f.name !== "qr")
        .forEach(f => deleteOldSessionFiles(path.join(dir, f.name)));
}

deleteOldSessionFiles(baseDir);
console.log("✅ Cleanup complete!");
