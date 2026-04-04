import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const dataFile = path.join(process.cwd(), "data.json");

// ✅ Ensure file exists
if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({}, null, 2));
}

// ✅ Helper function
const loadData = () => JSON.parse(fs.readFileSync(dataFile, "utf8"));
const saveData = (data) =>
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

/* ------------------------------------------------------------------
   ✅ 1) GET settings by key (dynamic)
   ------------------------------------------------------------------*/
app.get("/settings", (req, res) => {
    const data = loadData();

    res.status(200).json(data || {});
});

// app.get("/settings/:key", (req, res) => {
//     const key = req.params.key;
//     const data = loadData();

//     res.status(200).json({
//         key,
//         value: data[key] ?? []
//     });
// });

/* ------------------------------------------------------------------
   ✅ 2) POST settings by key (dynamic)
   Overwrites or creates a new key section
   ------------------------------------------------------------------*/
app.post("/settings/update", (req, res) => {
    const payload = req.body;
    saveData(payload);

    res.status(200).json({
        success: true,
        message: `Saved successfully`,
        value: payload
    });
});
app.post("/settings/:key", (req, res) => {
    const key = req.params.key;
    const payload = req.body;

    const data = loadData();
    data[key] = payload; // overwrite or create

    saveData(data);

    res.status(200).json({
        success: true,
        message: `Saved ${key} successfully`,
        value: payload
    });
});

/* ------------------------------------------------------------------
   ✅ 3) DELETE single item inside a key array by id
   Example: DELETE /settings/savedFilters_Leads/17624064
   ------------------------------------------------------------------*/
app.delete("/settings/:key/:id", (req, res) => {
    const { key, id } = req.params;
    const data = loadData();

    if (!Array.isArray(data[key])) {
        return res.status(400).json({
            success: false,
            message: `${key} must be an array to delete items`
        });
    }

    // Remove item with matching id
    data[key] = data[key].filter((item) => item.id != id);

    saveData(data);

    res.status(200).json({
        success: true,
        message: `Deleted item ${id} from ${key}`,
        updated: data[key]
    });
});

// ✅ Start server
app.listen(5000, () => {
    console.log("Server running at http://localhost:4000");
});
