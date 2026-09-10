import RoadmapApp from "@/components/roadmap/roadmap-app";
import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!await getUser()) redirect("/login");
  return <RoadmapApp />;
}
