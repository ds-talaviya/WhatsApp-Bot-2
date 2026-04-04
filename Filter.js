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

// ✅ Helper functions
const loadData = () => JSON.parse(fs.readFileSync(dataFile, "utf8"));
const saveData = (data) =>
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

/* ------------------------------------------------------------------
   ✅ GET UserFilter/GetByname/Filter
   ------------------------------------------------------------------*/
app.get("/UserFilter/GetByname/Filter", (req, res) => {
    const data = loadData();

    const response = {
        Success: true,
        Message: "Success",
        Description: null,
        Data: data["Filter"] || null,
        Count: 0,
    };

    res.status(200).json(response);
});

/* ------------------------------------------------------------------
   ✅ POST UserFilter/Update  (Create or Update Filter)
   ------------------------------------------------------------------*/
app.post("/UserFilter/Update", (req, res) => {
    const { StoreName = "Filter", StoreValue, OtherDetail = null } = req.body;

    if (!StoreValue) {
        return res.status(400).json({
            Success: false,
            Message: "StoreValue is required",
        });
    }

    const data = loadData();

    // Create or update the static "Filter" key
    data[StoreName] = {
        Id: 7,
        User: null,
        UserId: 1,
        StoreName,
        StoreValue,
        OtherDetail,
        UpdatedDate: new Date().toISOString(),
    };

    saveData(data);

    res.status(200).json({
        Success: true,
        Message: "Saved successfully",
        Description: null,
        Data: data[StoreName],
        Count: 0,
    });
});

// ✅ Start server
app.listen(5000, () => {
    console.log("✅ Server running at http://localhost:5000");
});
