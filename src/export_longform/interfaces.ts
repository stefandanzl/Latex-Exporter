import type { TFile } from "obsidian";
import { Header } from "./headers";

export interface node {
	unroll(
		data: metadata_for_unroll,
		settings: ExportPluginSettings
	): Promise<node[]>;
	latex(
		buffer: Buffer,
		buffer_offset: number,
		settings: ExportPluginSettings
	): Promise<number>;
}

export interface ExportPluginSettings {
	mySetting: string;
	template_path: string;
	base_output_folder: string;
	documentStructureType: "article" | "book";
	sectionTemplateNames: string[];
	preamble_file: string;
	bib_file: string;
	prioritize_lists: boolean;
	default_citation_command: string;
	display_env_titles: boolean;
	default_env_name_to_file_name: boolean;
	last_external_folder: string;
	template_folder: string;
}

export const DEFAULT_SETTINGS: ExportPluginSettings = {
	mySetting: "default",
	template_path: "",
	base_output_folder: "/",
	documentStructureType: "article",
	sectionTemplateNames: ["abstract", "appendix"],
	preamble_file: "",
	bib_file: "",
	prioritize_lists: false, // Whether to parse lists or equations first. Lists first allows lists containing display equations, but yields bugs because lines within an equation can easily start with '-'.
	default_citation_command: "cite",
	display_env_titles: true,
	default_env_name_to_file_name: false,
	last_external_folder: "",
	template_folder: "",
};

export const HEADING_STRUCTURE = {
	article: { 1: "section", 2: "subsection", 3: "subsubsection" },
	book: { 1: "chapter", 2: "section", 3: "subsection", 4: "subsubsection" },
} as const;

export type HEADING_STRUCTURE = typeof HEADING_STRUCTURE;

export const DEFAULT_LATEX_TEMPLATE = `
\\documentclass{article}
\\input{header}
{{PREAMBLE}}

\\addbibresource{bibliography.bib}
\\title{$title$}
\\author{$author$}

\\begin{document}
\\maketitle

$abstract$

$body$

$customSections$

\\printbibliography

$appendix$

\\end{document}
`;

export type parsed_note = {
	yaml: { [key: string]: string };
	body: node[];
};

export type note_cache = { [key: string]: parsed_note };

export type metadata_for_unroll = {
	in_thm_env: boolean;
	depth: number;
	env_hash_list: string[];
	parsed_file_bundle: note_cache; // use the path of the files as keys.
	ambient_header_level: number; // What header level are we currently in? The header level of consideration here is the global one.
	headers_level_offset: number; // By how much the header levels written in the md file must be adjusted because of embed considerations.
	explicit_env_index: number;
	longform_file: TFile;
	current_file: TFile;
	read_tfile: (file: TFile) => Promise<string>;
	find_file: (address: string) => TFile | undefined;
	header_stack: Header[];
	media_files: TFile[];
	bib_keys: string[];
};

export function init_data(
	longform_file: TFile,
	read_tfile: (file: TFile) => Promise<string>,
	find_file: (address: string) => TFile | undefined
): metadata_for_unroll {
	return {
		in_thm_env: false,
		depth: 0,
		env_hash_list: [] as string[],
		parsed_file_bundle: {} as note_cache,
		ambient_header_level: 0,
		headers_level_offset: 0,
		explicit_env_index: 1,
		longform_file: longform_file,
		current_file: longform_file,
		read_tfile: read_tfile,
		find_file: find_file,
		header_stack: [], // file-local stack of headers.
		media_files: [],
		bib_keys: [],
	} as metadata_for_unroll;
}

export function address_is_image_file(address: string) {
	if (
		/\.(?:jpeg|svg|pdf|png|jpg|gif|svg|pdf|tiff|excalidraw?)$/.exec(address)
	) {
		return true;
	}
	return false;
}

export async function unroll_array(
	data: metadata_for_unroll,
	content_array: node[],
	settings: ExportPluginSettings
) {
	const new_children: node[] = [];
	for (const elt of content_array) {
		new_children.push(...(await elt.unroll(data, settings)));
	}
	return new_children;
}
