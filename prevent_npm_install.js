const ua = process.env.npm_config_user_agent || "";
if (!ua.startsWith("pnpm")) {
  console.log("Use `pnpm install` to install dependencies in this repository");
  process.exit(1);
}