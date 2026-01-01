import express from "express";
import cors from "cors";
import { getLeaderboard } from "../db/student_stats.model.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
   origin: ["https://tobioffice.github.io", "http://localhost:5173"]
}));
app.use(express.json());

// API Routes
app.get("/api/leaderboard", async (req, res) => {
   try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const sortBy = (req.query.sort as "attendance" | "midmarks") || "attendance";
      
      const filters = {
         year: req.query.year === "all" ? undefined : (req.query.year as string),
         branch: req.query.branch === "all" ? undefined : (req.query.branch as string),
         section: req.query.section === "all" ? undefined : (req.query.section as string),
      };

      const offset = (page - 1) * limit;

      const data = await getLeaderboard(sortBy, limit, offset, filters);

      res.json({
         success: true,
         page,
         limit,
         data,
      });
   } catch (error) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ success: false, error: "Internal Server Error" });
   }
});

export const startServer = () => {
   app.listen(PORT, () => {
      console.log(`🚀 API Server running on port ${PORT}`);
   });
};
