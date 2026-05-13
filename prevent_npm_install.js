const ua = process.env.npm_config_user_agent || "";
const execpath = process.env.npm_execpath || "";

// Positive pnpm signals → allow
if (
  ua.startsWith("pnpm") ||
  execpath.includes("pnpm") ||
  process.env.PNPM_PACKAGE_NAME ||
  process.env.PNPM_HOME
) {
  process.exit(0);
}

// Positive npm signals → block
if (ua.startsWith("npm/") || /\bnpm-cli\.js$/.test(execpath)) {
  console.log("Use `pnpm install` to install dependencies in this repository");
  process.exit(1);
}

// Unknown invoker → allow rather than break CI
process.exit(0);
