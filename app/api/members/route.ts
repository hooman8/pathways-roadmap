import { workspaceApi } from "@/lib/server-workspace";
export const dynamic = "force-dynamic";
export const PUT = (request: Request) => workspaceApi(request, "members");
