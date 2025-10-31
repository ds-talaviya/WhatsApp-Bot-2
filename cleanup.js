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
            if (file !== "creds.json") {
                fs.unlinkSync(path.join(qrFolder, file));
                console.log("🧹 Deleted:", path.join(qrFolder, file));
            }
        });
    }

    // Recurse into subdirectories (skip qr folders)
    fs.readdirSync(dir, { withFileTypes: true })
        .filter(f => f.isDirectory() && f.name !== "qr")
        .forEach(f => deleteOldSessionFiles(path.join(dir, f.name)));
}