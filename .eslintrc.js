module.exports = {
	extends: [ "eslint:recommended" ],
	parserOptions: {
		ecmaVersion: 2018,
		sourceType: "module"
	},
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
