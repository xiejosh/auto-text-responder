import type { NextConfig } from "next";
import path from "path";
import dotenv from "dotenv";

// Load .env.local from project root so we don't need a separate one in dashboard/
dotenv.config({ path: path.join(process.cwd(), '..', '.env.local') });

const nextConfig: NextConfig = {};

export default nextConfig;
