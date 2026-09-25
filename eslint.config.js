import { config as defineConfig, configs } from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", "node_modules/", "playwright-report/", "test-results/", "blob-report/"] },
  ...configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "all", argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);