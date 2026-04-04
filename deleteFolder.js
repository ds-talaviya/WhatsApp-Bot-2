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
            // Skip creds.json and files starting with "session"
            if (file === "creds.json" || file.startsWith("session")) return;

            try {
                const filePath = path.join(qrFolder, file);
                fs.unlinkSync(filePath);
                console.log("🧹 Deleted:", filePath);
            } catch (err) {
                console.error("❌ Error deleting file:", file, err.message);
            }
        });
    }

    // Recurse into subdirectories (skip qr folders)
    fs.readdirSync(dir, { withFileTypes: true })
        .filter(f => f.isDirectory() && f.name !== "qr")
        .forEach(f => deleteOldSessionFiles(path.join(dir, f.name)));
}
