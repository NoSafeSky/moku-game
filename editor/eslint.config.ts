import biomeConfig from "eslint-config-biome";
import jsdocPlugin from "eslint-plugin-jsdoc";
import sonarjs from "eslint-plugin-sonarjs";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default [
  // 1. Global ignores
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "bun.lock",
      ".claude/**",
      ".planning/**",
      "node_modules/**"
    ]
  },

  // 2. TypeScript parser for all TS files
  tseslint.configs.base,

  // 3. Unicorn recommended + abbreviation allowlist + PascalCase components
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      // Components are PascalCase (EditorPage.tsx); islands/lib are kebab-case — allow both.
      "unicorn/filename-case": ["error", { cases: { kebabCase: true, pascalCase: true } }],
      "unicorn/prevent-abbreviations": [
        "error",
        {
          allowList: {
            ctx: true,
            fn: true,
            cb: true,
            ref: true,
            args: true,
            params: true,
            props: true,
            env: true,
            i18n: true,
            l10n: true,
            spa: true,
            ssg: true,
            ssr: true,
            seo: true,
            api: true,
            dev: true,
            prod: true,
            md: true,
            dir: true,
            doc: true,
            docs: true,
            db: true,
            util: true,
            utils: true,
            pkg: true,
            src: true,
            dist: true,
            config: true,
            cfg: true,
            e2e: true,
            cli: true,
            dom: true,
            css: true,
            html: true,
            url: true,
            uri: true,
            str: true,
            num: true,
            msg: true,
            err: true,
            req: true,
            res: true,
            opts: true,
            attr: true,
            el: true
          }
        }
      ]
    }
  },

  // 4. SonarJS recommended
  // biome-ignore lint/style/noNonNullAssertion: sonarjs types mark configs as possibly undefined but it exists at runtime
  sonarjs.configs!.recommended,

  // 5. JSDoc TypeScript preset
  jsdocPlugin.configs["flat/recommended-typescript-error"],

  // 5b. JSDoc style overrides
  {
    rules: {
      "jsdoc/no-types": "off",
      "jsdoc/tag-lines": ["error", "never", { startLines: 1 }]
    }
  },

  // 6. Source .ts files: documented exports. Scoped to declarations — island method
  //    shorthands (createIsland) and inline route render arrows do NOT each require JSDoc.
  {
    files: ["src/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            ClassDeclaration: true,
            FunctionDeclaration: true
          },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"]
        }
      ],
      "jsdoc/require-description": "error",
      "jsdoc/require-param": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-example": "error",
      "unicorn/require-module-specifiers": "off"
    }
  },

  // 6b. Consistent type imports across all source (.ts + .tsx)
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }]
    }
  },

  // 6c. Preact component/entry files (.tsx): documented by the @file header + component name,
  //     not per-function JSDoc (pure SSG components take no params and return a VNode).
  {
    files: ["src/**/*.tsx"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-example": "off"
    }
  },

  // 7. Test files: relaxed rules
  {
    files: ["tests/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-example": "off",
      "unicorn/no-useless-undefined": "off",
      "sonarjs/no-duplicate-string": "off",
      "unicorn/prevent-abbreviations": "off"
    }
  },

  // 8. Scripts + config files: relaxed rules
  {
    files: ["scripts/**/*.ts", "*.config.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "unicorn/no-abusive-eslint-disable": "off",
      "unicorn/prevent-abbreviations": "off"
    }
  },

  // 9. MUST be last: eslint-config-biome disables rules Biome handles
  biomeConfig
];
