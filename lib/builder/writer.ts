﻿/**
 * @fileOverview 写入器
 * @author xuld <xuld@vip.qq.com>
 */
import { Writable, WritableOptions } from "stream";
import { SourceMapBuilder } from "../utility/sourceMap";
import { File } from "./file";

/**
 * 表示一个写入器。
 */
export class Writer {

    // #region 基本属性

    /**
     * 获取当前写入的目标文件。
     */
    readonly file: File;

    /**
     * 初始化新的写入器。
     * @param file 写入的目标文件。
     * @param options 写入的选项。
     */
    constructor(file: File, options?: WriterOptions) {
        this.file = file;
        if (options && options.indentChar != null) this.indentChar = options.indentChar;
    }

    // #endregion

    // #region 缩进

    /**
     * 获取或设置当前使用的缩进字符串。
     */
    indentString = "";

    /**
     * 获取或设置当前使用的缩进字符。
     */
    indentChar = "\t";

    /**
     * 增加一个缩进。
     */
    indent() { this.indentString += this.indentChar; }

    /**
     * 减少一个缩进。
     */
    unindent() { this.indentString = this.indentString.substr(0, this.indentString.length - this.indentChar.length); }

    // #endregion

    // #region 写入

    /**
     * 获取最终生成的文本内容。
     */
    protected content = "";

    /**
     * 写入一段文本。
     * @param content 要写入的内容。
     * @param sourceFile 内容的源文件。
     * @param sourceLine 内容在源文件中的行号。行号从 0 开始。
     * @param sourceColumn 内容在源文件中的列号。列号从 0 开始。
     */
    write(content: string, sourceFile?: File, sourceLine?: number, sourceColumn?: number) {
        this.content += this.indentString ? content.replace(/\r\n?|\n/g, "$&" + this.indentString) : content;
    }

    /**
     * 返回当前生成的代码。
     * @returns 返回完整的代码。
     */
    toString() { return this.content; }

    /**
     * 将当前写入器的内容保存到文件。
     */
    end() { this.file.content = this.content; }

    // #endregion

}

/**
 * 表示一个支持源映射的写入器。
 */
export class SourceMapWriter extends Writer {

    /**
     * 存储当前使用的源映射生成器。
     */
    private readonly _sourceMapBuilder = new SourceMapBuilder;

    /**
     * 获取当前生成的源映射。
     */
    get sourceMap() { return this._sourceMapBuilder.toJSON(); }

    /**
     * 初始化新的写入器。
     * @param file 写入的目标文件。
     * @param options 写入的选项。
     */
    constructor(file: File, options?: WriterOptions) {
        super(file, options);
        this._sourceMapBuilder.file = file.srcPath;
    }

    /**
     * 存储当前写入的行号。
     */
    private _currentLine = 0;

    /**
     * 存储当前写入的列号。
     */
    private _currentColumn = 0;

    /**
     * 写入一段文本。
     * @param content 要写入的内容。
     * @param sourceFile 内容的源文件。
     * @param sourceLine 内容在源文件中的行号。行号从 0 开始。
     * @param sourceColumn 内容在源文件中的列号。列号从 0 开始。
     */
    write(content: string, sourceFile?: File, sourceLine?: number, sourceColumn?: number) {

        // 计算内容的原始映射(可能不存在)。
        const srcSourceMap = sourceFile && sourceFile.sourceMapBuilder;

        // 计算最后一个换行符位置。
        // 如果值为 -1 说明 content 只有一行。
        let lastLineBreak = content.length;
        while (--lastLineBreak >= 0) {
            const ch = content.charCodeAt(lastLineBreak);
            if (ch === 13 /*\r*/ || ch === 10 /*\n*/) {
                break;
            }
        }

        // 依次写入每个字符。
        for (let i = 0; i < content.length; i++) {
            this.content += content.charAt(i);

            // 换行：更新行列号以及添加映射。
            let ch = content.charCodeAt(i);
            if (ch === 13/*\r*/) {
                if (content.charCodeAt(i + 1) === 10 /*\n*/) {
                    i++;
                    this.content += "\n";
                }
                ch = 10;
            }
            if (ch === 10 /*\n*/) {
                this._currentLine++;
                sourceLine++;
                sourceColumn = 0;
                if (this.indentString) {
                    this.content += this.indentString;
                    this._currentColumn = this.indentString.length;
                } else {
                    this._currentColumn = 0;
                }
            }

            // 首次/换行：添加映射。
            if (sourceFile && (ch === 10/*\n*/ || i === 0)) {

                // 映射 _currentLine,_currentColumn -> sourceLine,sourceColumn。
                const mappings = this._sourceMapBuilder.mappings[this._currentLine] || (this._sourceMapBuilder.mappings[this._currentLine] = []);
                mappings.push({
                    column: this._currentColumn,
                    sourceIndex: this._sourceMapBuilder.addSource(sourceFile.srcPath || sourceFile.destPath || ""),
                    sourceLine,
                    sourceColumn
                });

                // 如果 content 本身存在映射，需要复制 content 在 sourceLine 的所有映射点。
                if (srcSourceMap) {
                    for (const mapping of srcSourceMap.mappings[sourceLine] || []) {

                        // 第一行：忽略 sourceColumn 之前的映射。
                        if (i === 0 && mapping.column < sourceColumn) {
                            continue;
                        }

                        // 最后一行：忽略 content 存放后最新长度之后的映射。
                        if (i === lastLineBreak && mapping.column >= content.length + (i === 0 ? sourceColumn : -lastLineBreak)) {
                            break;
                        }

                        // 复制源信息，但 mapping.column 更新为 newColumn。
                        const newColumn = mapping.column - sourceColumn + this._currentColumn;

                        // 之前已添加过当前行首的映射信息。
                        // 如果 srcSourceMap 已经包含了行首的映射信息，则覆盖之前的映射。
                        if (mappings.length && mappings[mappings.length - 1].column === newColumn) {
                            mappings.pop();
                        }

                        // 复制一个映射点。
                        mappings.push({
                            column: newColumn,
                            sourceIndex: this._sourceMapBuilder.addSource(srcSourceMap.sources[mapping.sourceIndex]),
                            sourceLine: mapping.sourceLine,
                            sourceColumn: mapping.sourceColumn,
                            nameIndex: mapping.nameIndex
                        });

                    }
                }

            }

        }

        // 更新结果列。
        this._currentColumn = content.length + (lastLineBreak < 0 ? this._currentColumn : - lastLineBreak + (this.indentString ? this.indentString.length : 0));

    }

    /**
     * 将当前写入器的内容保存到文件。
     */
    end() {
        super.end();
        this.file.sourceMapData = this._sourceMapBuilder;
    }

}

/**
 * 表示写入器的配置。
 */
export interface WriterOptions {

    /**
     * 是否支持生成源映射。
     */
    sourceMap: boolean;

    /**
     * 缩进字符。
     */
    indentChar?: string;

}

/**
 * 表示一个缓存流。
 */
export class BufferStream extends Writable {

    /**
     * 获取当前写入的目标文件。
     */
    readonly file: File;

    /**
     * 存储最终的缓存。
     */
    private _buffer = Buffer.allocUnsafe(128 * 1024);

    /**
     * 存储当前流的长度。
     */
    private _length = 0;

    /**
     * 获取当前流的长度。
     */
    get length() { return this._length; }

    /**
     * 获取当前流的容器大小。
     */
    get capacity() { return this._buffer.length; }

    /**
     * 初始化新的缓存流。
     * @param file 写入的目标文件。
     * @param options 原始写入配置。
     */
    constructor(file: File, options: WritableOptions) {
        super(options);
        this.file = file;
    }

    /**
     * 确保当前流可以存放指定长度的缓存。
     * @param length 要设置的新长度。
     */
    ensureCapacity(length) {
        if (length < this._buffer.length) return;

        length = Math.min(length, this._buffer.length * 2 - 1);
        const newBuffer = Buffer.allocUnsafe(length);
        this._buffer.copy(newBuffer, 0, 0, this._length);
        this._buffer = newBuffer;
    }

    /**
     * 底层实现写入操作。
     * @param chunk 要写入的缓存。
     * @param encoding 写入的编码。
     * @param callback 写入的回调。
     * @internal
     */
    _write(chunk: Buffer, encoding: string, callback: Function) {
        this.ensureCapacity(this._length + chunk.length);
        chunk.copy(this._buffer, this._length, 0);
        this._length += chunk.length;
        callback();
    }

    /**
     * 获取当前流的内容。
     * @param start 开始的位置。
     * @param end 结束的位置。
     */
    toBuffer(start = 0, end = this.length) {
        const result = Buffer.allocUnsafe(end - start);
        this._buffer.copy(result, 0, start, end);
        return result;
    }

    /**
     * 将当前写入器的内容保存到文件。
     */
    end() { this.file.buffer = this.toBuffer(); }

}

/**
 * 表示流的配置。
 */
export type StreamOptions = WritableOptions;