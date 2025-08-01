import { TFile } from "obsidian";
import { ExportPluginSettings } from "../export_longform";

/**
 * Configuration for export operations
 */
export interface ExportConfig {
	readonly activeFile: TFile;
	readonly settings: ExportPluginSettings;
	readonly outputPath?: string;
}

/**
 * Result of an export operation
 */
export interface ExportResult {
	readonly success: boolean;
	readonly message: string;
	readonly outputPath?: string;
	readonly error?: Error;
}

/**
 * Configuration for file copying operations
 */
export interface FileCopyConfig {
	readonly sourceFile: TFile;
	readonly destinationPath: string;
	readonly overwrite: boolean;
	readonly createDirectory?: boolean;
}

/**
 * Result of a file operation
 */
export interface FileOperationResult {
	readonly success: boolean;
	readonly action: 'copied' | 'overwritten' | 'skipped' | 'created';
	readonly error?: Error;
}

/**
 * Export paths for a given export operation
 */
export interface ExportPaths {
	readonly outputFolderPath: string;
	readonly outputFileName: string;
	readonly outputFilePath: string;
	readonly headerPath: string;
	readonly preamblePath: string;
	readonly bibPath: string;
	readonly attachmentsPath: string;
}

/**
 * Configuration for template processing
 */
export interface TemplateConfig {
	readonly templateContent: string;
	readonly outputFile: TFile;
	readonly preambleFile?: TFile;
	readonly sectionTemplateNames: string[];
}

/**
 * Configuration for external export dialog
 */
export interface ExternalExportDialogResult {
	readonly cancelled: boolean;
	readonly selectedPath?: string;
}

/**
 * Configuration for warning modal
 */
export interface WarningModalConfig {
	readonly message: string;
	readonly onConfirm: () => void | Promise<void>;
	readonly onCancel?: () => void;
	readonly rememberChoiceOption?: boolean;
}

/**
 * Media file processing result
 */
export interface MediaFileProcessingResult {
	readonly copiedFiles: number;
	readonly overwrittenFiles: number;
	readonly skippedFiles: number;
	readonly errors: Error[];
}

/**
 * Validation result for export prerequisites
 */
export interface ExportValidationResult {
	readonly isValid: boolean;
	readonly errors: string[];
	readonly warnings: string[];
}
