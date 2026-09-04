import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, minified Draco decoder served as-is for the tower's GLB.
    "public/draco/**",
    // bar-martiri/ is its own Vite project with its own config; the Next rules do not apply to it.
    "bar-martiri/**",
  ]),
]);

export default eslintConfig;
