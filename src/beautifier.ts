import * as _ from "lodash";

import { Language } from "./language";
import { OptionsRegistry } from "./options";
import { InlineFlagManager } from "./InlineFlagManager";
import { DependencyOptions, DependencyManager } from "./DependencyManager";

/**
New name to rename the option (key) to.
Name of an option to configure for a beautifier.
*/
export type BeautifierOptionName = string;
/**
Function to process the given options and return a final option value.
*/
export type BeautifierOptionTransformFunction = (options: OptionValues) => any;
/**
Option that transforms one or more required options into a single value.
*/
export type BeautifyOptionTransform = [
  BeautifierOptionName[],
  BeautifierOptionTransformFunction
];
/**
Option that transforms a single option value with the same name.
*/
export type BeautifyOptionTransformSingleFunction = (optionValue: any) => any;
/**
Option for Beautifier given the Language.
*/
export type BeautifierLanguageOption =
  | boolean
  | BeautifierOptionName
  | BeautifyOptionTransformSingleFunction
  | BeautifyOptionTransform;
/**

*/
export interface BeautifierLanguageOptionComplex {
  [outOptionName: string]: BeautifierLanguageOption | undefined;
}
/**

true = supports language, enable all options
false = supports language, disable all options
complex = supports language with specific options
*/
export type BeautifierLanguageOptions =
  | boolean
  | BeautifierLanguageOptionComplex;
/**
Options for Beautifier.

Keys are the names of Languages.
*/
export interface BeautifierOptions {
  [languageName: string]: BeautifierLanguageOptions;
}

/**
Data given to Beautifier's Beautify function.
*/
export interface BeautifierBeautifyData {
  /**
  Text to beautify
  */
  text: string;
  /**
  Language of text.
  */
  language: Language;
  /**
  Option values for given Language.
  */
  options: { [outOptionName: string]: any };
  /**
  File path.
  */
  filePath?: string;
  /**
  Project directory path.
  */
  projectPath?: string;
  /**
  Promise.
  */
  Promise: typeof Promise;
  /**
   * Dependencies
   */
  dependencies: DependencyManager;
}

export interface LanguageOptionValues {
  [languageName: string]: OptionValues;
}

export interface OptionValues {
  [optionName: string]: any;
}

/**
Data given to Unibeautify to perform beautification with.
*/
export interface BeautifyData {
  /**
  Text to beautify.
  */
  text: string;
  /**
  Name of language to use for beautification.
  */
  languageName?: string;
  /**
  File extension.
  */
  fileExtension?: string;
  /**
  Atom editor grammar.
  */
  atomGrammar?: string;
  /**
  Sublime Text editor syntax.
  */
  sublimeSyntax?: string;
  /**
   * VSCode Document Selector
   */
  vscodeLanguage?: string;
  /**
  File path.
  */
  filePath?: string;
  /**
  Project path.
  */
  projectPath?: string;
  /**
  Option values.
  */
  options: LanguageOptionValues;
}

export type BeautifierName = string;
/**
Beautifier
*/
export interface Beautifier {
  /**
  Unique identifying name of the beautifier.
  */
  name: BeautifierName;
  /**
  Supports options of the beautifier.
  */
  options: BeautifierOptions;
  /**
   * Parsed Package.json file as JSON.
   */
  // tslint:disable-next-line:no-reserved-keywords
  package?: object;
  /**
   * Runtime dependencies of the beautifier.
   */
  dependencies?: DependencyOptions[];
  /**
  Beautify the given code with the beautifier.
  */
  beautify(data: BeautifierBeautifyData): Promise<string>;
}

export interface BeautifierInternal extends Beautifier {
  dependencyManager: DependencyManager;
}

/**
Beautifier
*/
export class Unibeautify {
  /**

  */
  private options: OptionsRegistry = {};
  /**

  */
  private languages: Language[] = [];
  /**

  */
  private beautifiers: BeautifierInternal[] = [];

  /**
   * Get loaded languages which have a loaded beautifier supporting the given option
   */
  public getLanguagesSupportingOption(
    optionName: BeautifierOptionName
  ): Language[] {
    return this.supportedLanguages.filter(
      language =>
        this.beautifiers.findIndex(beautifier =>
          this.doesBeautifierSupportOptionForLanguage({
            beautifier,
            language,
            optionName,
          })
        ) !== -1
    );
  }

  /**
   * Get options supported for language and all loaded beautifiers
   */
  public getOptionsSupportedForLanguage(language: Language): OptionsRegistry {
    return this.beautifiers.reduce(
      (options, beautifier) => ({
        ...options,
        ...this.getOptionsSupportedByBeautifierForLanguage({
          beautifier,
          language,
        }),
      }),
      {}
    );
  }

  /**
   * Get options supported by beautifier for a language.
   */
  public getOptionsSupportedByBeautifierForLanguage({
    beautifier,
    language,
  }: {
    beautifier: Beautifier;
    language: Language;
  }): OptionsRegistry {
    const keys: BeautifierOptionName[] = optionKeys(beautifier, language);
    const allOptions = this.options;
    return keys.reduce((options, key) => {
      const option = allOptions[key];
      if (!option) {
        return options;
      }
      return {
        ...options,
        [key]: option,
      };
    }, {});
  }

  /**
   * Get all loaded languages which have at least one supporting beautifier.
   */
  public get supportedLanguages(): Language[] {
    return this.getLoadedLanguages().filter(language =>
      Boolean(this.getBeautifierForLanguage(language))
    );
  }

  /**
  Beautify code
  */
  public beautify(data: BeautifyData): Promise<string> {
    const lang: Language | null = this.getLanguage(data);
    if (lang == null) {
      return Promise.reject(new Error("Cannot find language."));
    }
    const langOptions: OptionValues = Unibeautify.getOptionsForLanguage(
      lang,
      data.options
    );

    const {
      selectedBeautifiers,
      missingBeautifierName,
    } = this.beautifiersForLanguageAndOptions(lang, langOptions);
    if (selectedBeautifiers.length === 0) {
      return Promise.reject(
        new Error(`Beautifiers not found for Language: ${lang.name}`)
      );
    }
    if (missingBeautifierName) {
      return Promise.reject(
        new Error(`Beautifier not found: ${missingBeautifierName}`)
      );
    }

    return this.beautifyWithBeautifiers({
      beautifiers: selectedBeautifiers as BeautifierInternal[],
      fileExtension: data.fileExtension,
      langOptions,
      language: lang,
      projectPath: data.projectPath,
      text: data.text,
    });
  }

  private getLanguage(data: {
    atomGrammar?: BeautifyData["atomGrammar"];
    fileExtension?: BeautifyData["fileExtension"];
    languageName?: BeautifyData["languageName"];
    sublimeSyntax?: BeautifyData["sublimeSyntax"];
  }): Language | null {
    const langs: Language[] = this.findLanguages({
      atomGrammar: data.atomGrammar,
      extension: data.fileExtension,
      name: data.languageName,
      sublimeSyntax: data.sublimeSyntax,
    });
    return langs.length > 0 ? langs[0] : null;
  }

  private beautifiersForLanguageAndOptions(
    lang: Language,
    langOptions: OptionValues
  ): {
    selectedBeautifiers: (BeautifierInternal | undefined)[];
    missingBeautifierName: string | undefined;
  } {
    const allBeautifiers: BeautifierInternal[] = this.getBeautifiersForLanguage(
      lang
    );
    const beautifierNames: string[] = langOptions.beautifiers || [];
    const selectedBeautifiers: (BeautifierInternal | undefined)[] =
      beautifierNames.length > 0
        ? this.beautifiersWithNames(beautifierNames, allBeautifiers)
        : allBeautifiers;

    const missingBeautifierName: string | undefined = selectedBeautifiers
      .map((curr, index) => (curr ? undefined : beautifierNames[index]))
      .find(curr => !!curr);
    return {
      missingBeautifierName,
      selectedBeautifiers,
    };
  }

  private beautifiersWithNames(
    names: string[],
    beautifiers: BeautifierInternal[]
  ): (BeautifierInternal | undefined)[] {
    const beautifiersByName = beautifiers.reduce(
      (index, current) => {
        index[current.name] = current;
        return index;
      },
      {} as { [beautifierName: string]: BeautifierInternal }
    );
    return names.map(name => beautifiersByName[name]);
  }

  private beautifyWithBeautifiers({
    beautifiers,
    language,
    langOptions,
    fileExtension,
    projectPath,
    text,
  }: {
    beautifiers: BeautifierInternal[];
    language: Language;
    langOptions: OptionValues;
    text: BeautifyData["text"];
    fileExtension: BeautifyData["fileExtension"];
    projectPath: BeautifyData["projectPath"];
  }): Promise<string> {
    return beautifiers.reduce(
      (promise: Promise<string>, beautifier: BeautifierInternal) => {
        const options: OptionValues = Unibeautify.getOptionsForBeautifier(
          beautifier,
          language,
          langOptions
        );
        return promise.then(currentText => {
          const { dependencyManager } = beautifier;
          return dependencyManager.load().then(() => {
            return beautifier
              .beautify({
                dependencies: dependencyManager,
                filePath: fileExtension,
                language: language,
                options,
                projectPath: projectPath,
                Promise,
                text: currentText,
              })
              .then(newText => {
                const manager = new InlineFlagManager(currentText, newText);
                return manager.text;
              });
          });
        });
      },
      Promise.resolve(text)
    );
  }

  /**
  Find and return the appropriate Languages that match any of the given filter criteria.
  An empty array will be returned if there are no matches.

  Precedence:
  - name
  - namespace
  - extension
  - atomGrammar
  - sublimeSyntax
  - vscodeLanguage
  */
  public findLanguages(query: {
    /**
    Language name
    */
    name?: string;
    /**
    Language namespace
    */
    namespace?: string;
    /**
    Language extension
    */
    extension?: string;
    /**
    Language Atom grammar
    */
    atomGrammar?: string;
    /*
    Language Sublime Syntax
    */
    sublimeSyntax?: string;
    /**
     * VSCode Language ID
     */
    vscodeLanguage?: string;
  }): Language[] {
    const langs: Language[] = [
      ...this.languages.filter(lang => lang.name === query.name),
      ...this.languages.filter(lang => lang.namespace === query.namespace),
      ...this.languages.filter(lang => query.extension && lang.extensions.indexOf(query.extension) !== -1),
      ...this.languages.filter(lang => query.atomGrammar && lang.atomGrammars.indexOf(query.atomGrammar) !== -1),
      ...this.languages.filter(lang => query.sublimeSyntax && lang.sublimeSyntaxes.indexOf(query.sublimeSyntax) !== -1),
      ...this.languages.filter(lang => query.vscodeLanguage && lang.vscodeLanguages.indexOf(query.vscodeLanguage) !== -1),
    ];

    return this.unique(langs);
  }

  private unique(array: any[]): any[] {
    return array.reduce((acc, val) => acc.indexOf(val) === -1
      ? acc.concat(val)
      : acc
    , []);
  }

  /**
  Get a shallow copy of the languages currently loaded.
  */
  public getLoadedLanguages(): Language[] {
    return this.languages.slice();
  }

  /**
   * Get first loaded beautifier for given language.
   */
  private getBeautifierForLanguage(language: Language): Beautifier | undefined {
    return this.beautifiers.find(
      beautifier => this.doesBeautifierSupportLanguage(beautifier, language)
    );
  }

  /**
   * Find and return the appropriate Beautifiers for the given Language.
   */
  public getBeautifiersForLanguage(language: Language): BeautifierInternal[] {
    return this.beautifiers.filter(
      beautifier => this.doesBeautifierSupportLanguage(beautifier, language)
    );
  }

  private doesBeautifierSupportLanguage(
    beautifier: Beautifier,
    language: Language
  ): boolean {
    return beautifier.options.hasOwnProperty(language.name);
  }

  /**
   * Get loaded beautifiers which have a loaded languages supporting the given option
   */
  public getBeautifiersSupportingOption(
    optionName: BeautifierOptionName
  ): Beautifier[] {
    return this.beautifiers.filter(
      beautifier =>
        this.languages.findIndex(language =>
          this.doesBeautifierSupportOptionForLanguage({
            beautifier,
            language,
            optionName,
          })
        ) !== -1
    );
  }

  /**
   * Determine whether beautifier supports option for a language
   */
  public doesBeautifierSupportOptionForLanguage({
    beautifier,
    language,
    optionName,
  }: {
    beautifier: Beautifier;
    language: Language;
    optionName: BeautifierOptionName;
  }): boolean {
    return optionKeys(beautifier, language).indexOf(optionName) !== -1;
  }

  /**
   * Find loaded languages the given beautifier supports.
   */
  public getLanguagesForBeautifier(beautifier: Beautifier): Language[] {
    const { options } = beautifier;
    return this.languages.filter(lang => options.hasOwnProperty(lang.name));
  }

  /**
   * Get a shallow copy of the options currently loaded.
   */
  public get loadedOptions(): OptionsRegistry {
    return { ...this.options };
  }

  /**
   * Get a shallow copy of the beautifiers currently loaded.
   */
  public get loadedBeautifiers(): Beautifier[] {
    return this.beautifiers.slice();
  }

  /**
  Extract the Language-specific option values.
  */
  public static getOptionsForLanguage(
    language: Language,
    options: LanguageOptionValues
  ): OptionValues {
    const { name } = language;
    return options[name] || {};
  }

  /**
  Extract the option values that the Beautifier supports, including applying transformations.
  */
  public static getOptionsForBeautifier(
    beautifier: Beautifier,
    language: Language,
    options: OptionValues
  ): OptionValues {
    const beautifierOptions = beautifier.options[language.name];
    // Transform options
    if (typeof beautifierOptions === "boolean") {
      if (beautifierOptions === true) {
        return options;
      } else {
        return {};
      }
    } else if (typeof beautifierOptions === "object") {
      return Object.keys(beautifierOptions).reduce((acc, key) => {
        const option = beautifierOptions[key];
        if (typeof option === "string") {
          return {
            [key]: options[option],
            ...acc,
          };
        } else if (typeof option === "function") {
          return {
            [key]: option(options[key]),
            ...acc,
          };
        } else if (option === true) {
          return {
            [key]: options[key],
            ...acc,
          };
        } else if (option instanceof Array) {
          const [fields, fn] = option;
          const values = fields.map(field => options[field]);
          const obj = this.zipObject(fields, values);
          return {
            [key]: fn(obj),
            ...acc,
          };
        } else {
          return new Error(
            `Invalid option "${key}" with value ${JSON.stringify(option)}.`
          );
        }
      }, {});
    } else {
      return options;
    }
  }

  private static zipObject(keys: string[], values: string[]) {
    return keys.reduce((acc, key, idx) => ({
      [key]: values[idx],
      ...acc,
    }), {});
  }

  /**
  Load a Beautifier
  */
  public loadBeautifier(beautifier: Beautifier): Unibeautify {
    this.beautifiers.push(this.internalBeautifier(beautifier));
    return this;
  }

  /**
  Load multiple beautifiers.
  */
  public loadBeautifiers(beautifiers: Beautifier[]): Unibeautify {
    beautifiers.forEach(beautifier => this.loadBeautifier(beautifier));
    return this;
  }

  private internalBeautifier(beautifier: Beautifier): BeautifierInternal {
    return {
      ...beautifier,
      dependencyManager: new DependencyManager(beautifier.dependencies || []),
    };
  }

  /**
  Load a Language
  */
  public loadLanguage(language: Language): Unibeautify {
    this.languages.push(language);
    return this;
  }

  /**
  Load multiple Languages
  */
  public loadLanguages(languages: Language[]): Unibeautify {
    this.languages.push(...languages);
    return this;
  }

  /**
  Load Options
  */
  public loadOptions(options: OptionsRegistry): Unibeautify {
    _.merge(this.options, options);
    return this;
  }
}

export function optionKeys(
  beautifier: Beautifier,
  language: Language
): BeautifierOptionName[] {
  const beautifierOptions = beautifier.options[language.name];
  // Transform options
  if (typeof beautifierOptions === "boolean") {
    return [];
  } else if (typeof beautifierOptions === "object") {
    const options: BeautifierOptionName[] = [];
    Object.keys(beautifierOptions).forEach(fieldKey => {
      const op = (<BeautifierLanguageOptionComplex>beautifierOptions)[fieldKey];
      if (typeof op === "string") {
        options.push(op);
      } else if (isOptionTransformSingleFunction(op)) {
        options.push(fieldKey as BeautifierOptionName);
      } else if (typeof op === "boolean") {
        if (op === true) {
          options.push(fieldKey as BeautifierOptionName);
        }
      } else if (isOptionTransform(op)) {
        options.push(...op[0]);
      } else {
        return new Error(
          `Invalid option "${fieldKey}" with value ${JSON.stringify(op)}.`
        );
      }
    });
    return options;
  } else {
    return [];
  }
}
function isOptionTransformSingleFunction(
  option: any
): option is BeautifyOptionTransformSingleFunction {
  return typeof option === "function";
}
function isOptionTransform(option: any): option is BeautifyOptionTransform {
  return Array.isArray(option);
}
