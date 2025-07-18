import {
	node,
	metadata_for_unroll,
	unroll_array,
	ExportPluginSettings,
} from "./interfaces";
import { TFile } from "obsidian";
import { notice_and_warn, strip_newlines } from "./utils";
import { Text } from "./inline";
import { format_label } from "./labels";

// The custom part is a regex and a constructor. So a regex, and function to get the object from the regex
export function split_display<T extends node>(
	display_elts: node[],
	make_obj: (args: RegExpMatchArray, settings: ExportPluginSettings) => T,
	class_regexp: RegExp,
	settings: ExportPluginSettings
): node[] {
	const new_display = [] as node[];
	for (const elt of display_elts) {
		if (elt instanceof Paragraph) {
			console.assert(
				elt.elements.length == 1,
				"Paragraph should have only one element at this stage of parsing"
			);
			console.assert(
				elt.elements[0] instanceof Text,
				"Paragraph should have only one text element at this stage of parsing"
			);
			const inline_element = elt.elements[0] as Text;
			let current_match: RegExpMatchArray | null = null;
			let start_index = 0;
			const string_to_parse = inline_element.content;
			while (
				(current_match = class_regexp.exec(string_to_parse)) !== null
			) {
				if (current_match.index == undefined) {
					throw new Error("current_match.index is undefined");
				}
				const prev_chunk = inline_element.content.slice(
					start_index,
					current_match.index
				);
				if (prev_chunk.trim() !== "") {
					new_display.push(
						new Paragraph([new Text(strip_newlines(prev_chunk))])
					);
				}
				new_display.push(make_obj(current_match, settings));
				start_index = current_match.index + current_match[0].length;
			}
			// Last part of the text, or all of it if no match
			const return_string = strip_newlines(
				inline_element.content.slice(start_index)
			);
			if (return_string.trim() !== "") {
				new_display.push(new Paragraph([new Text(return_string)]));
			}
		} else {
			new_display.push(elt);
		}
	}
	return new_display;
}

export class DisplayMath implements node {
	// parent: node;
	content: string;
	file_of_origin: TFile;
	label: string | undefined;
	explicit_env_name: string | undefined;
	static get_regexp(): RegExp {
		return /\$\$\s*(?:\\begin{(\S*?)}\s*([\S\s]*?)\s*\\end{\1}|([\S\s]*?))\s*?\$\$(?:\s*?{#(\S*?)})?/gs;
	}
	static build_from_match(
		match: RegExpMatchArray,
		settings: ExportPluginSettings
	): DisplayMath {
		const latex = match[2] === undefined ? match[3] : match[2];
		const label_match = /eq-(\w+)/.exec(match[1]);
		let label_val = match[1];
		if (label_match && label_match[1] !== undefined) {
			label_val = label_match[1];
		}
		return new DisplayMath(latex, match[4], label_val);
	}
	constructor(latex: string, label?: string, explicit_env?: string) {
		this.content = latex;
		this.label = label;
		this.explicit_env_name = explicit_env;
	}
	async unroll(data: metadata_for_unroll): Promise<node[]> {
		this.file_of_origin = data.current_file;
		return [this];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		let env_name = "equation*";
		if (this.label !== undefined) {
			env_name = "equation";
			if (
				this.explicit_env_name !== undefined &&
				["equation*", "align*"].includes(this.explicit_env_name)
			) {
				notice_and_warn(
					`Environment ${this.explicit_env_name} does not support labels.\n Ignoring label ${this.label}
In note:
` + this.file_of_origin.path
				);
			}
			if (
				this.explicit_env_name !== undefined &&
				["align"].includes(this.explicit_env_name)
			) {
				const label = format_label(this.label);
				const lines = this.content.split("\\\\");
				const numlines = lines.length;
				const labeled_lines: string[] = [];
				lines.forEach((line, index) => {
					if (line.trim() !== "") {
						let new_text = line + ` \\label{${label}:${index + 1}}`;
						if (index < numlines - 1) {
							new_text += "\\\\";
						}
						labeled_lines.push(new_text);
					}
				});
				this.content = labeled_lines.join("");
			} else {
				this.content =
					"\\label{" +
					format_label(this.label) +
					"}\n" +
					this.content;
			}
		}
		if (this.explicit_env_name !== undefined) {
			if (
				[
					"equation",
					"equation*",
					"align",
					"align*",
					"multline",
					"multline*",
					"gather",
					"gather*",
				].includes(this.explicit_env_name)
			) {
				env_name = this.explicit_env_name;
			} else {
				// env was stripped by regex, so add it back.
				this.content =
					"\\begin{" +
					this.explicit_env_name +
					"}\n" +
					this.content +
					"\n\\end{" +
					this.explicit_env_name +
					"}";
			}
		}
		buffer_offset += buffer.write(
			"\\begin{" + env_name + "}\n",
			buffer_offset
		);
		buffer_offset += buffer.write(this.content + "\n", buffer_offset);
		buffer_offset += buffer.write(
			"\\end{" + env_name + "}\n",
			buffer_offset
		);
		return buffer_offset;
	}
}

export class Paragraph implements node {
	elements: node[];
	constructor(elements: node[]) {
		this.elements = elements;
	}
	async unroll(
		data: metadata_for_unroll,
		settings: ExportPluginSettings
	): Promise<node[]> {
		const new_elements: node[] = [];
		for (const elt of this.elements) {
			new_elements.push(...(await elt.unroll(data, settings)));
		}
		this.elements = new_elements;
		return [this];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		let new_offset = buffer_offset;
		for (const elt of this.elements) {
			new_offset = await elt.latex(buffer, new_offset, settings);
		}
		new_offset += buffer.write("\n", new_offset);
		return new_offset;
	}
}

export class BlankLine implements node {
	static get_regexp(): RegExp {
		return /\n\s*\n/g;
	}
	static build_from_match(): BlankLine {
		return new BlankLine();
	}
	async unroll(): Promise<node[]> {
		return [this];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		return buffer_offset + buffer.write("\n", buffer_offset);
		// the other \n should be done at the end of the previous display object.
	}
}
export class DisplayCode implements node {
	language: string | undefined;
	executable: boolean;
	code: string;
	label: string;
	caption: string | undefined;
	file_of_origin: TFile;

	static get_regexp(): RegExp {
		return /```(?:({?)([a-zA-Z]*)(}?)\s*\n)?([\s\S]*?)```\s*(?:\{!([^}]+)\})?\s*\{#([^}]+)\}/g;
	}

	static build_from_match(
		match: RegExpMatchArray,
		settings: ExportPluginSettings
	): DisplayCode {
		const code = match[4];
		const executable = match[1] === "{" && match[3] === "}";
		const language = match[2] && match[2] !== "" ? match[2] : undefined;
		const caption = match[5]; // Optional caption from {!text}
		const codeId = match[6]; // Code ID from {#id}

		return new DisplayCode(code, language, executable, caption, codeId);
	}

	constructor(
		code: string,
		language?: string,
		executable: boolean = false,
		caption?: string,
		codeId?: string
	) {
		this.code = code;
		this.language = language;
		this.executable = executable;
		this.caption = caption;
		this.label = codeId || "";
	}

	async unroll(data: metadata_for_unroll): Promise<node[]> {
		this.file_of_origin = data.current_file;
		return [this];
	}

	private escapeLatex(text: string): string {
		return text
			.replace(/\\/g, "\\textbackslash{}")
			.replace(/&/g, "\\&")
			.replace(/%/g, "\\%")
			.replace(/\$/g, "\\$")
			.replace(/#/g, "\\#")
			.replace(/\^/g, "\\textasciicircum{}")
			.replace(/_/g, "\\_")
			.replace(/~/g, "\\textasciitilde{}")
			.replace(/\{/g, "\\{")
			.replace(/\}/g, "\\}");
	}

	private mapLanguageToListings(language: string): string {
		// Map to actual languages supported by listings package
		const languageMap: { [key: string]: string } = {
			js: "Java", // Best match for JavaScript
			javascript: "Java",
			ts: "Java",
			typescript: "Java",
			py: "Python",
			python: "Python",
			java: "Java",
			c: "C",
			cpp: "C++",
			"c++": "C++",
			csharp: "C", // listings has [Sharp]C but it's unstable
			cs: "C",
			php: "PHP",
			ruby: "Ruby",
			go: "Go", // listings does have Go!
			rust: "C", // No Rust, use C
			swift: "Swift", // listings has Swift!
			kotlin: "Java",
			scala: "Scala",
			r: "R",
			matlab: "Matlab",
			sql: "SQL",
			html: "HTML",
			xml: "HTML", // No XML, use HTML
			bash: "bash",
			sh: "bash",
			makefile: "make",
			tex: "TeX",
			latex: "TeX",
			haskell: "Haskell",
			perl: "Perl",
			lua: "Lua",
			fortran: "Fortran",
			pascal: "Pascal",
		};

		return languageMap[language.toLowerCase()] || "C"; // Default to C if unknown
	}

	private isLanguageSupported(language: string): boolean {
		// Languages that listings package actually supports
		const supportedLanguages = [
			"js",
			"javascript",
			"ts",
			"typescript", // mapped to Java
			"python",
			"py",
			"java",
			"c",
			"cpp",
			"c++",
			"csharp",
			"cs",
			"php",
			"ruby",
			"go",
			"rust",
			"swift",
			"kotlin",
			"scala",
			"r",
			"matlab",
			"sql",
			"html",
			"xml",
			"bash",
			"sh",
			"makefile",
			"tex",
			"latex",
		];

		return supportedLanguages.includes(language.toLowerCase());
	}

	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		if (this.language && this.isLanguageSupported(this.language)) {
			// Use listings package for syntax highlighting
			const mappedLanguage = this.mapLanguageToListings(this.language);

			buffer_offset += buffer.write(
				`\\begin{lstlisting}[language=${mappedLanguage}, basicstyle=\\ttfamily\\small, numbers=left, numberstyle=\\tiny, stepnumber=1, numbersep=5pt, backgroundcolor=\\color{gray!10}, frame=single, breaklines=true, showstringspaces=false`,
				buffer_offset
			);

			// Add caption and label if available
			if (this.caption) {
				buffer_offset += buffer.write(
					`, caption={${this.escapeLatex(
						this.caption
					)}}, label={lst:${this.label}}`,
					buffer_offset
				);
			} else if (this.label) {
				buffer_offset += buffer.write(
					`, label={lst:${this.label}}`,
					buffer_offset
				);
			}

			buffer_offset += buffer.write("]\n", buffer_offset);
			buffer_offset += buffer.write(this.code, buffer_offset);
			buffer_offset += buffer.write(
				"\n\\end{lstlisting}\n",
				buffer_offset
			);
		} else {
			// Fallback to verbatim (no syntax highlighting)
			buffer_offset += buffer.write("\\begin{verbatim}\n", buffer_offset);
			buffer_offset += buffer.write(this.code, buffer_offset);
			buffer_offset += buffer.write("\n\\end{verbatim}\n", buffer_offset);

			// Add caption after verbatim if available
			if (this.caption && this.label) {
				buffer_offset += buffer.write(
					`\\captionof{lstlisting}{${this.escapeLatex(
						this.caption
					)}}\\label{lst:${this.label}}\n`,
					buffer_offset
				);
			}
		}

		return buffer_offset;
	}
}

export class Quote implements node {
	content: string;

	static get_regexp(): RegExp {
		return /^>(.*)$/gm;
	}
	constructor(content: string) {
		this.content = content;
	}
	static build_from_match(
		regexmatch: RegExpMatchArray,
		settings: ExportPluginSettings
	): Quote {
		return new Quote(regexmatch[1]);
	}
	async unroll(): Promise<node[]> {
		return [this];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		return (
			buffer_offset +
			buffer.write("%" + this.content + "\n", buffer_offset)
		);
	}
}

export class NumberedList implements node {
	content: node[][];

	static get_regexp(): RegExp {
		return /(?<=^|\n)[ \t]*?1\. (.*?)(?:2\. (.*?))?(?:3\. (.*?))?(?:4\. (.*?))?(?:5\. (.*?))?(?:6\. (.*?))?(?:7\. (.*?))?(?:8\. (.*?))?(?:9\. (.*?))?(?:10\. (.*?))?(?:11\. (.*?))?(?:12\. (.*?))?(?:13\. (.*?))?(?:14\. (.*?))?(?:15\. (.*?))?(?:16\. (.*?))?(?:17\. (.*?))?(?:18\. (.*?))?(?:19\. (.*?))?(?:20\. (.*?))?$/gs;
	}
	constructor(content: node[][]) {
		this.content = content;
	}
	static build_from_match(
		regexmatch: RegExpMatchArray,
		settings: ExportPluginSettings
	): NumberedList {
		const list_contents: string[] = [];
		for (const e of regexmatch.slice(1)) {
			if (e === undefined) {
				break;
			}
			list_contents.push(e);
		}
		return new NumberedList(
			list_contents.map((e) => [new Paragraph([new Text(e)])])
		);
	}
	async unroll(
		data: metadata_for_unroll,
		settings: ExportPluginSettings
	): Promise<node[]> {
		const new_content: node[][] = [];
		for (const e of this.content) {
			new_content.push(await unroll_array(data, e, settings));
		}
		return [new NumberedList(new_content)];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		buffer_offset += buffer.write("\\begin{enumerate}\n", buffer_offset);
		for (const e of this.content) {
			buffer_offset += buffer.write("\\item ", buffer_offset);
			for (const f of e) {
				buffer_offset = await f.latex(buffer, buffer_offset, settings);
			}
		}
		buffer_offset += buffer.write("\\end{enumerate}\n", buffer_offset);
		return buffer_offset;
	}
}

export class UnorderedList implements node {
	content: node[][];
	static get_regexp(): RegExp {
		return /(?<=^|\n)[ \t]*?(?:-|\+|\*) (.*?)(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?(?:\n\s*?(?:-|\+|\*) (.*?))?$/gs;
	}

	constructor(content: node[][]) {
		this.content = content;
	}
	static build_from_match(
		regexmatch: RegExpMatchArray,
		settings: ExportPluginSettings
	): UnorderedList {
		const list_contents: string[] = [];
		for (const e of regexmatch.slice(1)) {
			if (e === undefined) {
				break;
			}
			list_contents.push(e);
		}
		return new UnorderedList(
			list_contents.map((e) => [new Paragraph([new Text(e)])])
		);
	}
	async unroll(
		data: metadata_for_unroll,
		settings: ExportPluginSettings
	): Promise<node[]> {
		const new_content: node[][] = [];
		for (const e of this.content) {
			new_content.push(await unroll_array(data, e, settings));
		}
		return [new UnorderedList(new_content)];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		buffer_offset += buffer.write("\\begin{itemize}\n", buffer_offset);
		for (const e of this.content) {
			buffer_offset += buffer.write("\\item ", buffer_offset);
			for (const f of e) {
				buffer_offset = await f.latex(buffer, buffer_offset, settings);
			}
		}
		buffer_offset += buffer.write("\\end{itemize}\n", buffer_offset);
		return buffer_offset;
	}
}

export class Comment implements node {
	content: string;
	static get_regexp(): RegExp {
		return /\%\%(.*?)\%\%/gs;
	}
	constructor(content: string) {
		this.content = content;
	}
	static build_from_match(
		regexmatch: RegExpMatchArray,
		settings?: ExportPluginSettings
	): Quote {
		return new Comment(regexmatch[1]);
	}
	async unroll(): Promise<node[]> {
		return [this];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		return buffer_offset;
	}
}
