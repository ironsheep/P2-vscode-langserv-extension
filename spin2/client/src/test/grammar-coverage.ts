/**
 * Grammar Coverage Analysis Tool
 *
 * This tool analyzes TextMate grammar files and test fixtures to measure
 * coverage of language constructs and identify untested patterns.
 */

import * as fs from 'fs';
import * as path from 'path';

interface GrammarRepository {
  [key: string]: any;
}

interface GrammarPattern {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  include?: string;
  patterns?: GrammarPattern[];
  captures?: any;
  beginCaptures?: any;
  endCaptures?: any;
}

interface GrammarDefinition {
  name: string;
  scopeName: string;
  patterns: GrammarPattern[];
  repository: GrammarRepository;
}

interface CoverageReport {
  totalPatterns: number;
  coveredPatterns: number;
  uncoveredPatterns: string[];
  coveragePercentage: number;
  patternsByCategory: Map<string, { total: number; covered: number }>;
}

export class GrammarCoverageAnalyzer {
  private grammar: GrammarDefinition;
  private allPatternNames: Set<string> = new Set();
  private repositoryKeys: Set<string> = new Set();

  constructor(grammarPath: string) {
    const grammarContent = fs.readFileSync(grammarPath, 'utf8');
    this.grammar = JSON.parse(grammarContent);
    this.extractAllPatterns();
  }

  /**
   * Extract all pattern names and repository keys from grammar
   */
  private extractAllPatterns(): void {
    // Extract top-level patterns
    if (this.grammar.patterns) {
      this.extractPatternsFromArray(this.grammar.patterns);
    }

    // Extract repository patterns
    if (this.grammar.repository) {
      for (const key of Object.keys(this.grammar.repository)) {
        this.repositoryKeys.add(key);
        const repoItem = this.grammar.repository[key];

        if (repoItem.name) {
          this.allPatternNames.add(repoItem.name);
        }

        if (repoItem.patterns) {
          this.extractPatternsFromArray(repoItem.patterns);
        }

        if (repoItem.beginCaptures || repoItem.endCaptures || repoItem.captures) {
          this.extractCaptureNames(repoItem);
        }
      }
    }
  }

  private extractPatternsFromArray(patterns: GrammarPattern[]): void {
    for (const pattern of patterns) {
      if (pattern.name) {
        this.allPatternNames.add(pattern.name);
      }

      if (pattern.patterns) {
        this.extractPatternsFromArray(pattern.patterns);
      }

      if (pattern.captures) {
        this.extractCaptureNames(pattern);
      }
    }
  }

  private extractCaptureNames(pattern: any): void {
    const captureGroups = [
      pattern.captures,
      pattern.beginCaptures,
      pattern.endCaptures
    ];

    for (const captures of captureGroups) {
      if (captures) {
        for (const key of Object.keys(captures)) {
          const capture = captures[key];
          if (capture.name) {
            this.allPatternNames.add(capture.name);
          }
          if (capture.patterns) {
            this.extractPatternsFromArray(capture.patterns);
          }
        }
      }
    }
  }

  /**
   * Analyze test coverage by examining test files
   */
  public analyzeCoverage(testFiles: string[]): CoverageReport {
    const testedPatterns = new Set<string>();
    const testedRepository = new Set<string>();

    // Read all test files
    for (const testFile of testFiles) {
      const content = fs.readFileSync(testFile, 'utf8');

      // Look for scope assertions in tests
      // Pattern: hasScope(result, 'scope.name')
      const scopeMatches = content.matchAll(/hasScope\([^,]+,\s*['"]([^'"]+)['"]/g);
      for (const match of scopeMatches) {
        const scope = match[1];
        testedPatterns.add(scope);

        // Mark any patterns that contain this scope
        for (const pattern of this.allPatternNames) {
          if (pattern.includes(scope) || scope.includes(pattern)) {
            testedPatterns.add(pattern);
          }
        }
      }

      // Look for repository references in tests
      for (const repoKey of this.repositoryKeys) {
        if (content.includes(repoKey) || content.includes(`"${repoKey}"`)) {
          testedRepository.add(repoKey);
        }
      }
    }

    // Calculate coverage
    const uncoveredPatterns: string[] = [];
    for (const pattern of this.allPatternNames) {
      if (!testedPatterns.has(pattern)) {
        uncoveredPatterns.push(pattern);
      }
    }

    const totalPatterns = this.allPatternNames.size;
    const coveredPatterns = testedPatterns.size;
    const coveragePercentage = totalPatterns > 0
      ? (coveredPatterns / totalPatterns) * 100
      : 0;

    // Categorize patterns
    const patternsByCategory = this.categorizePatterns(testedPatterns);

    return {
      totalPatterns,
      coveredPatterns,
      uncoveredPatterns,
      coveragePercentage,
      patternsByCategory
    };
  }

  /**
   * Categorize patterns by their scope prefix
   */
  private categorizePatterns(testedPatterns: Set<string>): Map<string, { total: number; covered: number }> {
    const categories = new Map<string, { total: number; covered: number }>();

    for (const pattern of this.allPatternNames) {
      const category = this.getPatternCategory(pattern);

      if (!categories.has(category)) {
        categories.set(category, { total: 0, covered: 0 });
      }

      const stats = categories.get(category)!;
      stats.total++;

      if (testedPatterns.has(pattern)) {
        stats.covered++;
      }
    }

    return categories;
  }

  /**
   * Extract category from pattern name
   */
  private getPatternCategory(pattern: string): string {
    const parts = pattern.split('.');

    if (parts.length > 1) {
      // Return first meaningful part (comment, keyword, constant, etc.)
      if (parts[0] === 'meta' && parts.length > 2) {
        return `${parts[0]}.${parts[1]}`;
      }
      return parts[0];
    }

    return 'other';
  }

  /**
   * Generate coverage report as formatted string
   */
  public generateReport(report: CoverageReport): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('='.repeat(80));
    lines.push('GRAMMAR COVERAGE REPORT');
    lines.push('='.repeat(80));
    lines.push('');
    lines.push(`Total Patterns: ${report.totalPatterns}`);
    lines.push(`Covered Patterns: ${report.coveredPatterns}`);
    lines.push(`Coverage: ${report.coveragePercentage.toFixed(2)}%`);
    lines.push('');

    lines.push('-'.repeat(80));
    lines.push('COVERAGE BY CATEGORY');
    lines.push('-'.repeat(80));
    lines.push('');

    const sortedCategories = Array.from(report.patternsByCategory.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (const [category, stats] of sortedCategories) {
      const percentage = stats.total > 0 ? (stats.covered / stats.total) * 100 : 0;
      const bar = this.createProgressBar(percentage, 40);
      lines.push(`${category.padEnd(30)} ${bar} ${stats.covered}/${stats.total} (${percentage.toFixed(1)}%)`);
    }

    lines.push('');
    lines.push('-'.repeat(80));
    lines.push('UNCOVERED PATTERNS');
    lines.push('-'.repeat(80));
    lines.push('');

    if (report.uncoveredPatterns.length === 0) {
      lines.push('  (All patterns covered!)');
    } else {
      const categorized = new Map<string, string[]>();

      for (const pattern of report.uncoveredPatterns) {
        const category = this.getPatternCategory(pattern);
        if (!categorized.has(category)) {
          categorized.set(category, []);
        }
        categorized.get(category)!.push(pattern);
      }

      for (const [category, patterns] of Array.from(categorized.entries()).sort()) {
        lines.push(`  ${category}:`);
        for (const pattern of patterns.sort()) {
          lines.push(`    - ${pattern}`);
        }
        lines.push('');
      }
    }

    lines.push('='.repeat(80));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Create a text progress bar
   */
  private createProgressBar(percentage: number, width: number): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }

  /**
   * Get all repository keys
   */
  public getRepositoryKeys(): string[] {
    return Array.from(this.repositoryKeys).sort();
  }

  /**
   * Get all pattern names
   */
  public getPatternNames(): string[] {
    return Array.from(this.allPatternNames).sort();
  }

  /**
   * Find patterns matching a keyword
   */
  public findPatternsForKeyword(keyword: string): string[] {
    const results: string[] = [];

    for (const key of this.repositoryKeys) {
      const repoItem = this.grammar.repository[key];

      if (repoItem.match && repoItem.match.includes(keyword)) {
        results.push(`${key} (repository)`);
      }
    }

    return results;
  }
}

/**
 * Main function to run coverage analysis
 */
export function runCoverageAnalysis(
  grammarPath: string,
  testFiles: string[],
  outputPath?: string
): void {
  const analyzer = new GrammarCoverageAnalyzer(grammarPath);
  const report = analyzer.analyzeCoverage(testFiles);
  const reportText = analyzer.generateReport(report);

  console.log(reportText);

  if (outputPath) {
    fs.writeFileSync(outputPath, reportText);
    console.log(`Report written to: ${outputPath}`);
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node grammar-coverage.js <grammar.json> <test1.ts> [test2.ts ...] [--output report.txt]');
    process.exit(1);
  }

  const grammarPath = args[0];
  const outputIndex = args.indexOf('--output');
  let outputPath: string | undefined;
  let testFiles: string[];

  if (outputIndex !== -1) {
    outputPath = args[outputIndex + 1];
    testFiles = args.slice(1, outputIndex);
  } else {
    testFiles = args.slice(1);
  }

  runCoverageAnalysis(grammarPath, testFiles, outputPath);
}
