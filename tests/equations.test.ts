jest.mock("obsidian");
import { get_latex_file_contents } from "./test_utils";
import { DEFAULT_SETTINGS } from "../src/export_longform/interfaces";

describe("my plugin", () => {
	test("test embedded eqn", async () => {
		const result = await get_latex_file_contents(
			"embed_eqn",
			DEFAULT_SETTINGS,
		);
		expect(result).toEqual(`\\begin{equation}
\\label{eq:ref}
\\sum
\\end{equation}
\\Cref{eq:ref}
`);
	});
	test("aligned env", async () => {
		const result = await get_latex_file_contents(
			"weird_equations",
			DEFAULT_SETTINGS,
		);
		expect(result).toEqual(`\\begin{equation*}
\\begin{aligned}
\\sum_{i = 1}^n
\\end{aligned}
\\end{equation*}
\\begin{align}
\\varepsilon \\label{eq:label:1}\\\\
\\varepsilon \\label{eq:label:2}\\\\
\\varepsilon \\label{eq:label:3}\\\\
\\end{align}
\\begin{equation}
\\begin{aligned}
\\label{eq:other}
\\varepsilon\\\\
\\varepsilon\\\\
\\varepsilon\\\\
\\end{aligned}
\\end{equation}
\\Cref{eq:label:1}
`);
	});
});
