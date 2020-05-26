module.exports = {
	parser: "@typescript-eslint/parser",
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: "module"
	},
	extends: [
		"plugin:@typescript-eslint/recommended", 
		"prettier/@typescript-eslint", 
		"plugin:prettier/recommended"
	],
	rules: {
		"comma-dangle": [ "warn", "never" ],
		"object-curly-spacing": [ "warn", "always" ],
		"array-bracket-spacing": [ "warn", "always" ],
		"comma-spacing": [ "warn", { before: false, after: true } ],
		"space-in-parens": [ "warn", "never" ],
		"array-element-newline": [ "warn", "consistent" ],
		"object-curly-newline": [ "warn", { consistent: true } ],
		"no-unused-vars": [ "warn" ]
	},
	env: {
		node: true,
		es6: true
	}
};
