import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", ".test-out/**", "node_modules/**"],
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      "no-console": "error",
      "no-unused-vars": "off",
    },
  },
];
