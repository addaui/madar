import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// ADR 0063: the React 19 conventions, enforced. The hooks plugin's recommended preset includes the React Compiler rules.
export default tseslint.config(
  { ignores: ["dist", "src/api/contract.d.ts"] },
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"] ?? reactHooks.configs.recommended,
  {
    rules: {
      "no-restricted-imports": ["error", { paths: [
        { name: "react", importNames: ["forwardRef"], message: "ref is a normal prop in React 19 (ADR 0063 rule 6)." },
        { name: "react", importNames: ["useMemo", "useCallback", "memo"], message: "The React Compiler memoizes (ADR 0063 rule 18). Add one only with a measurement and a comment." },
        { name: "react-dom", importNames: ["render", "hydrate", "findDOMNode"], message: "Use createRoot (ADR 0063 rule 1)." },
      ] }],
      "no-restricted-syntax": ["error",
        { selector: "MemberExpression[property.name='Provider']", message: "Render the context itself as the provider (ADR 0063 rule 7)." },
        { selector: "MemberExpression[property.name='defaultProps']", message: "No defaultProps: use default parameter values (ADR 0063 rule 5)." },
        { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='use']", message: "A hook must be a function named useSomething: the React Compiler memoizes a method called `.use()` as plain code and breaks the hook order." },
      ],
    },
  },
);
