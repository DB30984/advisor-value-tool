import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: base must match your GitHub repo name exactly, wrapped in slashes.
// e.g. if your repo is github.com/yourname/advisor-value-tool,
// your live URL will be yourname.github.io/advisor-value-tool/
// and base below must be "/advisor-value-tool/".
// If you rename the repo, update this line to match.
export default defineConfig({
  plugins: [react()],
  base: "/advisor-value-tool/",
});
