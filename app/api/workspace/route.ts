import { workspaceApi } from "@/lib/server-workspace";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => workspaceApi(request, "get");
export const PUT = (request: Request) => workspaceApi(request, "save");
