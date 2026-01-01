import express from "express";
import cors from "cors";
import { getLeaderboard } from "../db/student_stats.model.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
   origin: "https://tobioffice.github.io"
}));
app.use(express.json());

// API Routes
app.get("/api/leaderboard", async (req, res) => {
   try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const sortBy = (req.query.sort as "attendance" | "midmarks") || "attendance";

      const offset = (page - 1) * limit;

      const data = await getLeaderboard(sortBy, limit, offset);

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
