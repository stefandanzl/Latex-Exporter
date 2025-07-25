import * as path from "path";
import {
	address_is_image_file,
	node,
	ExportPluginSettings,
	unroll_array,
} from "./interfaces";
import { Notice, TFile } from "obsidian";
import { metadata_for_unroll } from "./interfaces";
import { Text } from "./inline";
import {
	parse_embed_content,
	traverse_tree_and_parse_inline,
} from "./parseMarkdown";
import {
	parse_display,
	parse_after_headers,
	parse_yaml_header,
} from "./parseMarkdown";
import { Paragraph, BlankLine } from "./display";
import { strip_newlines, notice_and_warn, find_image_file } from "./utils";
import { label_from_location, explicit_label, format_label } from "./labels";
import { assert } from "console";

export class EmbedWikilink implements node {
	attribute: string | undefined;
	content: string;
	header: string | undefined;
	display: string | undefined;
	label: string | undefined;
	static get_regexp(): RegExp {
		return /(?:(\S*?)::\s*\n?\s*)?!\[\[([\s\S]*?)(?:#([\s\S]+?))?(?:\|([\s\S]*?))?\]\]/g;
	}
	static build_from_match(
		args: RegExpMatchArray,
		settings: ExportPluginSettings
	): EmbedWikilink {
		return new EmbedWikilink(args[1], args[2], args[3], args[4]);
	}
	constructor(
		attribute: string | undefined,
		address: string,
		header: string | undefined,
		displayed: string | undefined
	) {
		this.attribute = attribute;
		this.content = address;
		this.header = header;
		this.display = displayed;
	}

	async unroll(
		data: metadata_for_unroll,
		settings: ExportPluginSettings
	): Promise<node[]> {
		if (address_is_image_file(this.content)) {
			const file = find_image_file(data.find_file, this.content);
			if (file === undefined) {
				const err_msg =
					"Content not found: Could not find the content of the plot with image '" +
					this.content +
					"'";
				notice_and_warn(err_msg);
				return [
					new BlankLine(),
					new Paragraph([new Text(err_msg)]),
					new BlankLine(),
				];
			} else {
				data.media_files.push(file);
				const p = new Plot(file, data.current_file, this.display);
				p.label = await label_from_location(
					data,
					file.name,
					data.current_file,
					settings
				);
				// Resolve the label early. We can do this because label_from_location will not need to resolve headers.
				return [p];
			}
		}
		const return_data = await parse_embed_content(
			this.content,
			data.find_file,
			data.read_tfile,
			data.parsed_file_bundle,
			data.current_file,
			settings,
			this.header
		);
		if (return_data === undefined) {
			const err_msg =
				"Content not found: Could not find the content of \\emph{" +
				this.content +
				"} with header \\emph{" +
				this.header +
				"}";
			const other_err_msg =
				"Content not found: Could not find the content of '" +
				this.content +
				"' with header '" +
				this.header +
				"'";
			new Notice(other_err_msg);
			return [
				new BlankLine(),
				new Paragraph([new Text(err_msg)]),
				new BlankLine(),
			];
		}
		const [
			parsed_contents,
			level_of_header_being_embedded,
			embedded_file_yaml,
		] = return_data;
		const ambient_header_level_outside = data.ambient_header_level;
		const ambient_header_offset_outside = data.headers_level_offset;
		const ambient_header_stack = data.header_stack;
		data.header_stack = [];
		data.headers_level_offset =
			data.ambient_header_level - level_of_header_being_embedded;
		const unrolled_contents = [] as node[];
		const was_in_thm_env = data.in_thm_env;
		if (this.attribute !== undefined) {
			//unrolling within an environment
			data.in_thm_env = true;
		}
		const candidate_file = data.find_file(this.content);
		if (candidate_file === undefined) {
			throw new Error("Could not find file: " + this.content);
		}
		const ambient_current_file = data.current_file;
		data.current_file = candidate_file;
		for (const elt of parsed_contents) {
			unrolled_contents.push(...(await elt.unroll(data, settings)));
		}
		if (!was_in_thm_env) {
			data.in_thm_env = false;
		}
		data.ambient_header_level = ambient_header_level_outside;
		data.headers_level_offset = ambient_header_offset_outside;
		data.current_file = ambient_current_file;
		data.header_stack = ambient_header_stack;
		const address =
			this.content === "" ? data.longform_file.basename : this.content;
		if (this.attribute !== undefined) {
			return [
				new Environment(
					unrolled_contents,
					this.attribute,
					await label_from_location(
						data,
						address,
						data.current_file,
						settings,
						this.header
					),
					address,
					embedded_file_yaml,
					this.display
				),
			];
		}
		return unrolled_contents;
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	): Promise<number> {
		console.error(
			"Embed wikilink " +
				this.content +
				"should have been unrolled to something else"
		);
		return 0;
	}
}

export class Plot implements node {
	image: TFile;
	label: string;
	caption: string | undefined;
	file_of_origin: TFile;
	constructor(image: TFile, current_file: TFile, caption?: string) {
		this.file_of_origin = current_file;
		this.image = image;
		this.caption = caption;
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
		buffer_offset += buffer.write(
			`\\begin{figure}[h]
\\centering
\\includegraphics[width=\\textwidth]{` +
				"Attachments" +
				"/" +
				this.image.name +
				"}\n", // Cannot use path.join, because the path is a latex path.
			buffer_offset
		);
		let caption_text: string;
		if (this.caption === undefined) {
			caption_text = "";
			const warning =
				"WARNING: Figure created from '" +
				this.image.name +
				"' has no caption.\n" +
				"You may want to add one in the display part of the wikilink: for example,\n" +
				"![[plot.png|my caption]]\n" +
				"In note:\n" +
				this.file_of_origin.path;
			notice_and_warn(warning);
		} else {
			caption_text = this.caption;
		}
		buffer_offset += buffer.write(
			"\\caption{" + caption_text + "\\label{" + this.label + "}}\n",
			buffer_offset
		);
		buffer_offset += buffer.write("\\end{figure}\n", buffer_offset);
		return buffer_offset;
	}
}

export class Table implements node {
	rows: string[][];
	headers: string[];
	label: string;
	caption: string | undefined;
	file_of_origin: TFile;

	static get_regexp(): RegExp {
		// Matches markdown tables with optional caption in {!text}{#id} format
		return /\|(.+)\|\s*\n\s*\|[\s\-\|:]+\|\s*\n((?:\s*\|.+\|\s*\n?)*)\s*(?:\{!([^}]+)\})?\s*\{#([^}]+)\}/gm;
	}

	static build_from_match(
		match: RegExpMatchArray,
		settings: ExportPluginSettings
		// current_file: TFile
	): Table {
		const headerLine = match[1]; // Header row content
		const dataRows = match[2]; // All data rows
		const caption = match[3]; // Optional caption from {!text}
		const tableId = match[4]; // Table ID from {#id}

		return new Table(headerLine, dataRows, caption, tableId);
	}

	constructor(
		headerLine: string,
		dataRowsText: string,
		caption?: string,
		tableId?: string
	) {
		// this.file_of_origin = current_file;
		this.caption = caption;
		this.label = tableId || "";
		this.parseTableParts(headerLine, dataRowsText);
	}

	private parseTableParts(headerLine: string, dataRowsText: string) {
		// Parse headers from the header line
		this.headers = this.parseTableRow(headerLine);

		// Parse data rows from the data rows text
		this.rows = [];
		const lines = dataRowsText.trim().split("\n");

		for (const line of lines) {
			if (line.includes("|")) {
				const row = this.parseTableRow(line);
				if (row.length > 0) {
					this.rows.push(row);
				}
			}
		}
	}

	private parseTableRow(line: string): string[] {
		// Split by |, trim whitespace, remove empty first/last elements
		const cells = line.split("|").map((cell) => cell.trim());

		// Remove empty cells from start and end (outer | characters)
		if (cells[0] === "") cells.shift();
		if (cells[cells.length - 1] === "") cells.pop();

		return cells;
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

	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		// Begin table environment
		buffer_offset += buffer.write(
			`\\begin{table}[h]\n\\centering\n`,
			buffer_offset
		);

		// Create column specification based on number of columns
		const columnSpec = "c".repeat(this.headers.length);
		buffer_offset += buffer.write(
			`\\begin{tabular}{${columnSpec}}\n\\hline\n`,
			buffer_offset
		);

		// Write headers
		const escapedHeaders = this.headers.map((h) => this.escapeLatex(h));
		const headerRow = escapedHeaders.join(" & ") + " \\\\\n";
		buffer_offset += buffer.write(headerRow, buffer_offset);
		buffer_offset += buffer.write("\\hline\n", buffer_offset);

		// Write data rows
		for (const row of this.rows) {
			const escapedRow = row.map((cell) => this.escapeLatex(cell));
			const dataRow = escapedRow.join(" & ") + " \\\\\n";
			buffer_offset += buffer.write(dataRow, buffer_offset);
		}

		// End tabular environment
		buffer_offset += buffer.write(
			`\\hline\n\\end{tabular}\n`,
			buffer_offset
		);

		// Handle caption
		let caption_text: string;
		if (this.caption === undefined) {
			caption_text = "";
			const warning =
				"WARNING: Table has no caption.\n" +
				"You may want to add one when creating the table.\n" +
				"In note:\n";
			notice_and_warn(warning);
		} else {
			caption_text = this.escapeLatex(this.caption);
		}

		buffer_offset += buffer.write(
			"\\caption{" + caption_text + "\\label{tbl:" + this.label + "}}\n",
			buffer_offset
		);

		// End table environment
		buffer_offset += buffer.write("\\end{table}\n", buffer_offset);

		return buffer_offset;
	}
}

export class Wikilink implements node {
	attribute: string | undefined;
	content: string;
	header: string | undefined;
	displayed: string | undefined;
	static get_regexp(): RegExp {
		return /(?:(\S*?)::\s*\n?\s*)?\[\[([\s\S]*?)(?:\#([\s\S]*?))?(?:\|([\s\S]*?))?\]\]/g;
	}
	static build_from_match(
		args: RegExpMatchArray,
		settings: ExportPluginSettings
	): Wikilink {
		return new Wikilink(args[1], args[2], args[3], args[4]);
	}
	constructor(
		attribute: string | undefined,
		address: string,
		header: string | undefined,
		displayed: string | undefined
	) {
		this.attribute = attribute;
		this.content = address;
		this.header = header;
		this.displayed = displayed;
	}
	async unroll(
		data: metadata_for_unroll,
		settings: ExportPluginSettings
	): Promise<node[]> {
		if (this.content === "" && this.header !== undefined) {
			this.content = data.current_file.basename;
		}
		return [
			new UnrolledWikilink(
				data,
				this.attribute,
				this.content,
				this.header,
				this.displayed
			),
		];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	) {
		if (this.header === undefined) {
			this.header = "";
		}
		return (
			buffer_offset +
			buffer.write(
				"[[" + this.content + "#" + this.header + "]]",
				buffer_offset
			)
		);
	}
}

export class Environment implements node {
	children: node[];
	// Can parse a label as well
	static get_regexp(): RegExp {
		return /^(\w+?)::(?:\s*?{#([\S ]*?)})?(.*?)::\1/gms;
	}
	label: string | undefined;
	type: string;
	address_of_origin: string | undefined;
	display_title: string | undefined;
	// address_of_origin: string | undefined;
	embedded_file_yaml: { [key: string]: string } | undefined;
	constructor(
		children: node[],
		type: string,
		label?: string,
		address_of_origin?: string,
		embedded_file_yaml?: { [key: string]: string },
		display_title?: string
	) {
		this.children = children;
		this.type = type.toLowerCase().trim();
		this.label = label;
		this.address_of_origin = address_of_origin;
		this.embedded_file_yaml = embedded_file_yaml;
		this.display_title = display_title;
	}
	static build_from_match(
		match: RegExpMatchArray,
		settings: ExportPluginSettings
	): Environment {
		// TODO: Creates an infinite loop; this is a problem.
		let [_, body] = parse_display(strip_newlines(match[3]), settings);
		body = parse_after_headers(body, settings);
		traverse_tree_and_parse_inline(body, settings);
		// if(match.index !== undefined){
		// 	match.index += match[0].length
		// }
		return new Environment(
			// Here we must run a full parsing on the contents instead of inserting a string.
			// parse_note(strip_newlines(match[3])).body,
			body,
			match[1],
			match[2]
		);
	}
	async unroll(
		data: metadata_for_unroll,
		settings: ExportPluginSettings
	): Promise<node[]> {
		// If it is unrolled, it is likely an explicit env.
		if (this.label !== undefined) {
			this.label = explicit_label(
				data.longform_file,
				data.current_file,
				this.label
			);
		}
		this.address_of_origin = undefined; // Do not display the name of the note as title for this one.
		this.children = await unroll_array(data, this.children, settings);
		return [this];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	): Promise<number> {
		let start_env_string = "\\begin{" + this.type + "}";
		if (this.type === "proof" && this.label !== undefined) {
			start_env_string +=
				"[\\hypertarget{" +
				this.label +
				"}Proof of \\Cref{" +
				this.label.replace("proof", "statement") +
				"}]";
		} else if (this.type !== "remark" && settings.display_env_titles) {
			if (this.display_title !== undefined) {
				if (this.display_title !== "") {
					start_env_string += "[" + this.display_title + "]";
				}
			} else if (
				this.embedded_file_yaml !== undefined &&
				this.embedded_file_yaml.env_title !== undefined
			) {
				if (
					this.embedded_file_yaml.env_title !== "" &&
					this.embedded_file_yaml.env_title !== null
				) {
					// empty string means no title at all.
					start_env_string +=
						"[" + this.embedded_file_yaml.env_title + "]";
				}
			} else if (
				settings.default_env_name_to_file_name &&
				this.address_of_origin !== undefined
			) {
				start_env_string += "[" + this.address_of_origin + "]";
			}
		}
		buffer_offset += buffer.write(start_env_string + "\n", buffer_offset);

		if (this.label !== undefined && this.type !== "proof") {
			buffer_offset += buffer.write(
				"\\label{" + format_label(this.label) + "}\n",
				buffer_offset
			);
		} else {
			buffer_offset += buffer.write("\n", buffer_offset);
		}
		for (const e of this.children) {
			buffer_offset = await e.latex(buffer, buffer_offset, settings);
		}
		buffer_offset += buffer.write(
			"\\end{" + this.type + "}\n",
			buffer_offset
		);
		return buffer_offset;
	}
}

export class Hyperlink implements node {
	address: string;
	label: string;
	static get_regexp(): RegExp {
		return /\[([^\[\]]+?)\]\((https?:\/\/[^\s]+?)\)/g;
	}
	static build_from_match(
		args: RegExpMatchArray,
		settings: ExportPluginSettings
	): Hyperlink {
		return new Hyperlink(args[1], args[2]);
	}
	constructor(label: string, address: string) {
		this.label = label;
		this.address = address;
	}
	async unroll(): Promise<node[]> {
		return [this];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	): Promise<number> {
		return (
			buffer_offset +
			buffer.write(
				`\\href{${this.address}}{${this.label}}`,
				buffer_offset
			)
		);
	}
}

// The purpose of this class is to defer the label resolution until all files are parsed. So labels are determined in the latex() call.
export class UnrolledWikilink implements node {
	unroll_data: metadata_for_unroll;
	attribute: string | undefined;
	address: string;
	header: string | undefined;
	displayed: string | undefined;
	constructor(
		unroll_data: metadata_for_unroll,
		attribute: string | undefined,
		address: string,
		header: string | undefined,
		displayed: string | undefined
	) {
		assert(!/^@/.exec(address), "Should not be a citation");
		this.unroll_data = {
			in_thm_env: unroll_data.in_thm_env,
			depth: unroll_data.depth,
			env_hash_list: unroll_data.env_hash_list,
			parsed_file_bundle: unroll_data.parsed_file_bundle,
			ambient_header_level: unroll_data.ambient_header_level,
			headers_level_offset: unroll_data.headers_level_offset,
			explicit_env_index: unroll_data.explicit_env_index,
			find_file: unroll_data.find_file,
			read_tfile: unroll_data.read_tfile,
			longform_file: unroll_data.longform_file,
			current_file: unroll_data.current_file,
			header_stack: [...unroll_data.header_stack],
			media_files: [...unroll_data.media_files],
			bib_keys: [...unroll_data.bib_keys],
		};
		this.address = address;
		this.attribute = attribute;
		this.address = address;
		this.header = header;
		this.displayed = displayed;
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	): Promise<number> {
		const hasBeenEmbedded =
			this.unroll_data.parsed_file_bundle[this.address] !== undefined;
		const file = this.unroll_data.find_file(this.address);
		if (!file) {
			notice_and_warn(
				"Wikilink with address '" +
					this.address +
					"' points to no file. Wikilink is in file: '" +
					this.unroll_data.current_file.path +
					"'"
			);
			return (
				buffer_offset +
				buffer.write(
					"FAILED TO RESOLVE:[[" + this.address + "]]",
					buffer_offset
				)
			);
		}
		if (
			!hasBeenEmbedded &&
			!address_is_image_file(this.address) &&
			(!this.header || this.header.toLowerCase() === "statement")
		) {
			const file_contents = await this.unroll_data.read_tfile(file);
			const [yaml] = parse_yaml_header(file_contents);
			const bib_key_match = yaml.source?.match(
				/@([a-zA-Z0-9\-_]+)|\[\[@([a-zA-Z0-9\-_]+)\]\]/
			);
			const bib_key = bib_key_match
				? bib_key_match[1] || bib_key_match[2]
				: undefined;
			const published_result_name = yaml.published_result_name;
			if (bib_key && typeof published_result_name === "string") {
				const citation = new Citation(
					bib_key,
					"std",
					published_result_name || this.displayed
				);
				return citation.latex(buffer, buffer_offset, settings);
			} else {
				notice_and_warn(
					"address of reference '" +
						this.address +
						"' is referenced but was not embedded.\n" +
						"In note:\n" +
						this.unroll_data.current_file.path
				);
				return (
					buffer_offset +
					buffer.write(
						"FAILED TO RESOLVE:[[" + this.address + "]]",
						buffer_offset
					)
				);
			}
		}
		const label = await label_from_location(
			this.unroll_data,
			this.address,
			this.unroll_data.current_file,
			settings,
			this.header
		);
		if (this.displayed !== undefined) {
			return (
				buffer_offset +
				buffer.write(
					"\\hyperref[" + label + "]{" + this.displayed + "}",
					buffer_offset
				)
			);
		}
		if (this.header?.toLowerCase().trim() !== "proof") {
			return (
				buffer_offset +
				buffer.write("\\Cref{" + label + "}", buffer_offset)
			);
		} else {
			return (
				buffer_offset +
				buffer.write(
					"\\hyperlink{" + label + "}{the proof}",
					buffer_offset
				)
			);
		}
	}
	async unroll(): Promise<node[]> {
		return [this];
	}
}

export class PandocCitation {
	id: string;
	type: string | undefined;
	result: string | undefined;
	static get_regexp(): RegExp {
		return /(?:(?:@([^,.;\[\] ]+))|(?:\[(-)?@([^,;.\[\]\- ]+)(?:, ?([^\]\[]*))?\]))(?:\[([^\]@]*)\])?/g;
	}
	constructor(id: string, type?: string, suffix?: string) {
		this.id = id;
		this.type = type;
		this.result = suffix;
	}
	static build_from_match(
		args: RegExpMatchArray,
		settings: ExportPluginSettings
	): PandocCitation {
		let bibkey = undefined;
		let enclosed_in_brackets: boolean;
		if (args[1] != undefined) {
			bibkey = args[1];
			enclosed_in_brackets = false;
		} else if (args[3] != undefined) {
			bibkey = args[3];
			enclosed_in_brackets = true;
		} else {
			throw Error("Unexpected regex behaviour; no bibkey found");
		}
		let suffix = undefined;
		if (args[4] !== undefined) {
			suffix = args[4];
		} else if (args[5] !== undefined) {
			suffix = args[5];
		}
		const supressed = args[2] !== undefined;
		let citation_type: string;
		if (supressed) {
			citation_type = "year"; // [-@smith2021] → \citeyear
		} else if (enclosed_in_brackets) {
			citation_type = "parenthesis"; // [@smith2021] or [@smith2021, p. 14] → \parencite
		} else {
			citation_type = "txt"; // @smith2021 or @smith2021 [p. 14] → \textcite
		}
		if (suffix == "std" || suffix == "txt") {
			citation_type = suffix;
			suffix = undefined;
		}
		return new Citation(bibkey, citation_type, suffix);
	}
	async unroll(): Promise<node[]> {
		throw Error("Should not be unrolled.");
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	): Promise<number> {
		throw Error("Latex on this PandocCitation should not be called.");
	}
}

export class Citation implements node {
	// TODO: Make this a full item, not a result of an unroll.
	id: string;
	type: string | undefined;
	result: string | undefined;
	static get_regexp(): RegExp {
		return /(?:\[([^@\[]*?)\])?(?:(?:\[\[@([a-zA-Z0-9\.\-_]*)\]\]))(?:\[([^@\[]*?)\])?/g;
	}
	static build_from_match(
		args: RegExpMatchArray,
		settings: ExportPluginSettings
	): Citation {
		let captured_id = args[2];
		if (captured_id == "") {
			throw new Error("Unexpected: empty match for citation id.");
		}
		let type = undefined;
		let result = undefined;
		if (args[1] !== undefined) {
			result = args[1];
		} else if (args[3] !== undefined) {
			result = args[3];
		}
		if (result == "std" || result == "txt") {
			type = result;
			result = undefined;
		}
		return new Citation(captured_id, type, result);
	}
	constructor(id: string, type?: string, suffix?: string) {
		if (
			!(
				type == undefined ||
				type == "txt" ||
				type == "std" ||
				type == "year" ||
				type == "parenthesis"
			)
		) {
			notice_and_warn(
				"Invalid citation type: " + type + ". Reverting to default."
			);
			this.type = undefined;
		} else {
			this.type = type;
		}
		this.id = id;
		this.result = suffix;
	}
	async unroll(): Promise<node[]> {
		return [this];
	}
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	): Promise<number> {
		// TODO: change the use of textcite to an option in settings
		let citestring = "\\";
		let citeword;
		if (this.type == "txt") {
			citeword = "textcite";
		} else if (this.type == "std") {
			citeword = "cite";
		} else if (this.type == "parenthesis") {
			citeword = "parencite";
		} else if (this.type == "year") {
			citeword = "citeyear";
		} else if (this.type == undefined) {
			citeword = settings.default_citation_command;
		} else {
			throw Error("Invalid type: " + this.type);
		}
		citestring += citeword;
		if (this.result !== undefined) {
			citestring += "[" + this.result + "]";
		}
		citestring += "{" + this.id + "}";
		return buffer_offset + buffer.write(citestring, buffer_offset);
	}
}

export class MultiCitation implements node {
	// TODO: Make this a full item, not a result of an unroll.
	ids: string[];
	static get_regexp(): RegExp {
		return /(?:\[std\])?\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\]\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\](?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?(?:\[\[@([^\]:\|]*?)(?:\#[^\]\|]*?)?(?:\|[^\]]*?)?\]\])?/g;
	}
	static build_from_match(args: RegExpMatchArray): MultiCitation {
		return new MultiCitation(args);
	}
	constructor(args: string[]) {
		this.ids = [];
		for (const id of args.slice(1)) {
			if (id === undefined) {
				break;
			}
			this.ids.push(id);
		}
	}
	async unroll(): Promise<node[]> {
		return [this];
	}
	async latex(buffer: Buffer, buffer_offset: number): Promise<number> {
		buffer_offset += buffer.write("\\cite{", buffer_offset);
		for (const id of this.ids.slice(0, -1)) {
			buffer_offset += buffer.write(id + ", ", buffer_offset);
		}
		buffer_offset += buffer.write(
			this.ids[this.ids.length - 1] + "}",
			buffer_offset
		);
		return buffer_offset;
	}
}

export class AliasCitation implements node {
	id: string;
	type: string | undefined;
	result: string | undefined;
	
	static get_regexp(): RegExp {
		// Matches: [prefix][[filename|@alias]][suffix] with optional prefix and suffix
		return /(?:\[([^@\[]*?)\])?\[\[([^\|\]]+)\|(@[a-zA-Z0-9\.\-_]+)\]\](?:\[([^@\[]*?)\])?/g;
	}
	
	static build_from_match(
		args: RegExpMatchArray,
		settings: ExportPluginSettings
	): AliasCitation {
		const prefix = args[1]; // Optional prefix like "std", "txt"
		const filename = args[2]; // The actual filename  
		const alias = args[3].substring(1); // Remove @ prefix for citation
		const suffix = args[4]; // Optional suffix like "p. 14"
		
		let type = undefined;
		let result: string | undefined = suffix;
		
		// Handle prefix for citation type
		if (prefix !== undefined) {
			if (prefix === "std" || prefix === "txt" || prefix === "parenthesis" || prefix === "year") {
				type = prefix;
			} else {
				// If prefix is not a known type, treat it as result text
				result = prefix;
			}
		}
		
		// Handle suffix - if prefix was a type and we have suffix, use suffix as result
		if (type !== undefined && suffix !== undefined) {
			result = suffix;
		}
		
		// Special handling for "std" and "txt" in suffix (like regular Citation)
		if (result === "std" || result === "txt") {
			type = result;
			result = undefined;
		}
		
		return new AliasCitation(alias, type, result);
	}
	
	constructor(id: string, type?: string, suffix?: string) {
		if (
			!(
				type == undefined ||
				type == "txt" ||
				type == "std" ||
				type == "year" ||
				type == "parenthesis"
			)
		) {
			// Invalid type, default to textcite
			this.type = "txt";
		} else {
			this.type = type || "txt"; // Default to textcite for alias citations
		}
		this.id = id;
		this.result = suffix;
	}
	
	async unroll(): Promise<node[]> {
		return [this];
	}
	
	async latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	): Promise<number> {
		let citestring = "\\";
		let citeword;
		
		if (this.type == "txt") {
			citeword = "textcite";
		} else if (this.type == "std") {
			citeword = "cite";
		} else if (this.type == "parenthesis") {
			citeword = "parencite";
		} else if (this.type == "year") {
			citeword = "citeyear";
		} else if (this.type == undefined) {
			citeword = settings.default_citation_command;
		} else {
			throw Error("Invalid type: " + this.type);
		}
		
		citestring += citeword;
		if (this.result !== undefined) {
			citestring += "[" + this.result + "]";
		}
		citestring += "{" + this.id + "}";
		
		return buffer_offset + buffer.write(citestring, buffer_offset);
	}
}

export class PandocMultiCitation implements node {
	ids: string[];
	type: string;
	static get_regexp(): RegExp {
		return /(?<!\[)(\[)?@([a-zA-Z0-9\-_]+);[ \t]*(?:@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?(?:;[ \t]@([a-zA-Z0-9\-_]+))?\]?/g;
	}
	static build_from_match(args: RegExpMatchArray): PandocMultiCitation {
		return new PandocMultiCitation(args);
	}
	constructor(args: string[]) {
		this.ids = [];
		if (args[1] !== undefined) {
			this.type = "parenthesis";
		} else {
			this.type = "std";
		}
		for (const id of args.slice(2)) {
			if (id === undefined) {
				break;
			}
			this.ids.push(id);
		}
	}
	async unroll(): Promise<node[]> {
		return [this];
	}
	async latex(buffer: Buffer, buffer_offset: number): Promise<number> {
		let citeword = "cite";
		if (this.type == "parenthesis") {
			citeword = "parencite";
		}
		buffer_offset += buffer.write("\\" + citeword + "{", buffer_offset);
		for (const id of this.ids.slice(0, -1)) {
			buffer_offset += buffer.write(id + ", ", buffer_offset);
		}
		buffer_offset += buffer.write(
			this.ids[this.ids.length - 1] + "}",
			buffer_offset
		);
		return buffer_offset;
	}
}
