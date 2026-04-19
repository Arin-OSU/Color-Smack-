import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const building_id = searchParams.get("building_id");
  const utility = searchParams.get("utility");
  if (!building_id || !utility) return NextResponse.json([]);

  const filePath = path.join(
    process.cwd(), "data", "raw", "timeseries",
    `${building_id}__${utility}.json`
  );
  if (!existsSync(filePath)) return NextResponse.json([]);
  try {
    return NextResponse.json(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch {
    return NextResponse.json([]);
  }
}
