import fs from "fs";
import path from "path";

// Base directory where Baileys saves session folders
const BASE_DIR = path.join(process.cwd(), "auth_info");

// Define cleanup threshold (in minutes)
const CLEANUP_THRESHOLD_MINUTES = 3;

// Convert minutes to milliseconds
const CLEANUP_THRESHOLD_MS = CLEANUP_THRESHOLD_MINUTES * 60 * 1000;

function cleanupOldSessions() {
    console.log(`🧹 Running session cleanup... (${CLEANUP_THRESHOLD_MINUTES} min threshold)`);

    // If folder doesn't exist, skip
    if (!fs.existsSync(BASE_DIR)) {
        console.log("⚠️ auth_info folder not found, skipping cleanup.");
        return;
    }

    const now = Date.now();
    const sessionFolders = fs.readdirSync(BASE_DIR);

    sessionFolders.forEach(folder => {
        const fullPath = path.join(BASE_DIR, folder);
        const stats = fs.statSync(fullPath);

        // Skip non-directories
        if (!stats.isDirectory()) return;

        const lastModified = stats.mtimeMs;
        const ageMs = now - lastModified;

        if (ageMs > CLEANUP_THRESHOLD_MS) {
            console.log(`🗑️ Deleting old session: ${folder} (last modified ${(ageMs / 1000).toFixed(1)}s ago)`);
            fs.rmSync(fullPath, { recursive: true, force: true });
        }
    });
}

// Run cleanup every 2 minutes
setInterval(cleanupOldSessions, CLEANUP_THRESHOLD_MS);

// Run immediately on startup
cleanupOldSessions();

console.log("✅ Session cleanup scheduler started.");
