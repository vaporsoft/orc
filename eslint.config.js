import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Allow empty catch blocks — common pattern for intentional error swallowing
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Allow empty arrow functions — used as noop .catch() handlers throughout
      "@typescript-eslint/no-empty-function": "off",
      // Allow unused vars when prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    ignores: ["dist/", "node_modules/"],
  },
);
