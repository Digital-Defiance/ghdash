#!/usr/bin/env node
// Files uploaded in the studio are committed under media/. Serve them from <site>/media/.
import { cpSync, existsSync, rmSync } from "node:fs";

rmSync("public/media", { recursive: true, force: true });
if (existsSync("media")) {
	cpSync("media", "public/media", { recursive: true });
	console.log("copied media/ to public/media/");
}
