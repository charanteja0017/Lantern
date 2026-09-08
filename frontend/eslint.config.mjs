// Flat ESLint config for Next.js 16 + ESLint 9.
// Replaces the removed `next lint` command from Next.js 15.
//
// `eslint-config-next@16` now exports native flat configs, so we can compose
// them directly without going through FlatCompat / legacy eslintrc bridges.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "public/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "warn",
      // React 19.2 ships new strict rules via eslint-plugin-react-hooks v7.
      // They surface legitimate patterns in this codebase (hydrating state from
      // localStorage inside an effect, measuring elapsed time with
      // `performance.now()` inside async handlers). They're advisory rather
      // than bugs, so we keep them at `warn` instead of `error` to avoid
      // failing CI on non-actionable findings.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default eslintConfig;
