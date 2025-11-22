import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import * as vsctm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

/**
 * Grammar Coverage Tests for Spin2
 *
 * These tests validate that the TextMate grammar correctly tokenizes
 * all Spin2 language constructs based on the language specification.
 *
 * Coverage areas:
 * - Comments (line, block, documentation)
 * - Keywords (blocks, control flow, operators)
 * - Literals (numbers, strings)
 * - Operators (unary, binary, assignment)
 * - PASM instructions and registers
 * - Special constants and functions
 */

describe('Spin2 Grammar Coverage Tests', function() {
  let registry: vsctm.Registry;
  let grammar: vsctm.IGrammar | null;

  before(async function() {
    this.timeout(30000);

    try {
      // Initialize Oniguruma WASM
      const wasmBin = fs.readFileSync(
        path.join(__dirname, '../../../node_modules/vscode-oniguruma/release/onig.wasm')
      ).buffer;
      const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
        return {
          createOnigScanner(patterns: string[]) { return new oniguruma.OnigScanner(patterns); },
          createOnigString(s: string) { return new oniguruma.OnigString(s); }
        };
      });

      // Create registry
      registry = new vsctm.Registry({
        onigLib: vscodeOnigurumaLib,
        loadGrammar: async (scopeName: string) => {
          const grammarPath = path.join(
            __dirname,
            '../../../syntaxes/spin2.tmLanguage.json'
          );
          const grammarContent = fs.readFileSync(grammarPath, 'utf8');
          return vsctm.parseRawGrammar(grammarContent, grammarPath);
        }
      });

      // Load grammar
      grammar = await registry.loadGrammar('source.spin2');
      assert.ok(grammar, 'Grammar should be loaded');
    } catch (error) {
      console.error('Failed to initialize grammar:', error);
      throw error;
    }
  });

  /**
   * Helper function to tokenize a line and return scopes
   */
  function tokenizeLine(line: string, previousRuleStack?: vsctm.StateStack): vsctm.ITokenizeLineResult {
    if (!grammar) {
      throw new Error('Grammar not initialized');
    }
    return grammar.tokenizeLine(line, previousRuleStack || vsctm.INITIAL);
  }

  /**
   * Helper to check if any token contains the expected scope
   */
  function hasScope(result: vsctm.ITokenizeLineResult, expectedScope: string): boolean {
    return result.tokens.some(token =>
      token.scopes.some(scope => scope.includes(expectedScope))
    );
  }

  /**
   * Helper to get all scopes for debugging
   */
  function getAllScopes(result: vsctm.ITokenizeLineResult): string[] {
    return result.tokens.flatMap(token => token.scopes);
  }

  describe('Grammar Validation', () => {
    it('should load grammar file successfully', () => {
      assert.ok(grammar, 'Grammar should be defined');
    });

    it('should have correct scopeName', () => {
      const grammarPath = path.join(__dirname, '../../../syntaxes/spin2.tmLanguage.json');
      const grammarContent = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
      assert.strictEqual(grammarContent.scopeName, 'source.spin2');
    });

    it('should be valid JSON', () => {
      const grammarPath = path.join(__dirname, '../../../syntaxes/spin2.tmLanguage.json');
      const grammarContent = fs.readFileSync(grammarPath, 'utf8');
      assert.doesNotThrow(() => JSON.parse(grammarContent));
    });
  });

  describe('Comments Coverage', () => {
    it('should tokenize single-line comments', () => {
      const result = tokenizeLine("' This is a comment");
      assert.ok(hasScope(result, 'comment.line'), 'Should have comment.line scope');
    });

    it('should tokenize single-line comments after code', () => {
      const result = tokenizeLine("x := 42 ' inline comment");
      assert.ok(hasScope(result, 'comment.line'), 'Should have comment.line scope');
    });

    it('should tokenize block comments', () => {
      let result = tokenizeLine("{ block comment }");
      assert.ok(hasScope(result, 'comment.block'), 'Should have comment.block scope');
    });

    it('should tokenize multi-line block comments', () => {
      let ruleStack = vsctm.INITIAL;

      let result = tokenizeLine("{ Start of comment", ruleStack);
      assert.ok(hasScope(result, 'comment.block'), 'Line 1 should have comment.block');
      ruleStack = result.ruleStack;

      result = tokenizeLine("  middle line", ruleStack);
      assert.ok(hasScope(result, 'comment.block'), 'Line 2 should have comment.block');
      ruleStack = result.ruleStack;

      result = tokenizeLine("  end }", ruleStack);
      assert.ok(hasScope(result, 'comment.block'), 'Line 3 should have comment.block');
    });

    it('should tokenize documentation comments (block)', () => {
      const result = tokenizeLine("{{ Documentation }}");
      assert.ok(hasScope(result, 'comment.block.documentation'), 'Should have documentation scope');
    });

    it('should tokenize documentation comments (line)', () => {
      const result = tokenizeLine("'' Documentation line");
      assert.ok(hasScope(result, 'comment.line.documentation'), 'Should have documentation scope');
    });

    it('should NOT tokenize single quote inside string as comment', () => {
      const result = tokenizeLine('"don\'t parse this as comment"');
      // The string scope should take precedence
      assert.ok(hasScope(result, 'string'), 'Should recognize as string');
    });
  });

  describe('Block Keywords Coverage', () => {
    const blockKeywords = [
      { keyword: 'CON', scope: 'keyword.block.con' },
      { keyword: 'VAR', scope: 'keyword.block.var' },
      { keyword: 'OBJ', scope: 'keyword.block.obj' },
      { keyword: 'PUB', scope: 'keyword.block.pub' },
      { keyword: 'PRI', scope: 'keyword.block.pri' },
      { keyword: 'DAT', scope: 'keyword.block.dat' }
    ];

    blockKeywords.forEach(({ keyword, scope }) => {
      it(`should tokenize ${keyword} block keyword`, () => {
        const result = tokenizeLine(keyword);
        assert.ok(hasScope(result, scope), `Should have ${scope} scope`);
      });

      it(`should tokenize ${keyword} in lowercase`, () => {
        const result = tokenizeLine(keyword.toLowerCase());
        assert.ok(hasScope(result, scope), `Should handle case-insensitive ${keyword}`);
      });
    });
  });

  describe('Number Literals Coverage', () => {
    describe('Decimal Numbers', () => {
      it('should tokenize positive integers', () => {
        const result = tokenizeLine('42');
        assert.ok(hasScope(result, 'constant.numeric'), 'Should recognize decimal number');
      });

      it('should tokenize numbers with underscores', () => {
        const result = tokenizeLine('1_000_000');
        assert.ok(hasScope(result, 'constant.numeric'), 'Should recognize decimal with underscores');
      });

      it('should tokenize signed numbers', () => {
        const result = tokenizeLine('+123');
        assert.ok(hasScope(result, 'constant.numeric'), 'Should recognize positive signed');

        const result2 = tokenizeLine('-456');
        assert.ok(hasScope(result2, 'constant.numeric'), 'Should recognize negative signed');
      });
    });

    describe('Hexadecimal Numbers', () => {
      it('should tokenize hex numbers with $', () => {
        const result = tokenizeLine('$DEADBEEF');
        assert.ok(hasScope(result, 'constant.numeric.hexadecimal'), 'Should recognize hex');
      });

      it('should tokenize hex with underscores', () => {
        const result = tokenizeLine('$FF_00_AA');
        assert.ok(hasScope(result, 'constant.numeric.hexadecimal'), 'Should recognize hex with underscores');
      });
    });

    describe('Binary Numbers', () => {
      it('should tokenize binary numbers with %', () => {
        const result = tokenizeLine('%11010101');
        assert.ok(hasScope(result, 'constant.numeric.binary'), 'Should recognize binary');
      });

      it('should tokenize binary with underscores', () => {
        const result = tokenizeLine('%1101_0101');
        assert.ok(hasScope(result, 'constant.numeric.binary'), 'Should recognize binary with underscores');
      });
    });

    describe('Quaternary Numbers', () => {
      it('should tokenize quaternary numbers with %%', () => {
        const result = tokenizeLine('%%3210');
        assert.ok(hasScope(result, 'constant.numeric.quaternary'), 'Should recognize quaternary');
      });
    });

    describe('Float Numbers', () => {
      it('should tokenize float with decimal point', () => {
        const result = tokenizeLine('3.14159');
        assert.ok(hasScope(result, 'constant.numeric'), 'Should recognize float');
      });

      it('should tokenize scientific notation', () => {
        const result = tokenizeLine('1.23e-4');
        assert.ok(hasScope(result, 'constant.numeric'), 'Should recognize scientific notation');
      });

      it('should tokenize float without leading zero', () => {
        const result = tokenizeLine('.5');
        assert.ok(hasScope(result, 'constant.numeric'), 'Should recognize .5 as float');
      });
    });
  });

  describe('String Literals Coverage', () => {
    it('should tokenize double-quoted strings', () => {
      const result = tokenizeLine('"Hello, World!"');
      assert.ok(hasScope(result, 'string.quoted.double'), 'Should recognize string');
    });

    it('should tokenize empty strings', () => {
      const result = tokenizeLine('""');
      assert.ok(hasScope(result, 'string'), 'Should recognize empty string');
    });

    it('should tokenize strings with spaces', () => {
      const result = tokenizeLine('"   spaces   "');
      assert.ok(hasScope(result, 'string'), 'Should recognize string with spaces');
    });
  });

  describe('Control Flow Keywords Coverage', () => {
    const controlFlowKeywords = [
      'IF', 'IFNOT', 'ELSE', 'ELSEIF', 'ELSEIFNOT',
      'CASE', 'CASE_FAST', 'OTHER',
      'REPEAT', 'WITH', 'FROM', 'TO', 'STEP', 'UNTIL', 'WHILE',
      'NEXT', 'QUIT', 'RETURN', 'ABORT'
    ];

    controlFlowKeywords.forEach(keyword => {
      it(`should tokenize ${keyword} keyword`, () => {
        const result = tokenizeLine(`  ${keyword}`);
        assert.ok(hasScope(result, 'keyword.control.flow'), `Should recognize ${keyword}`);
      });
    });
  });

  describe('Built-in Constants Coverage', () => {
    const constants = [
      'TRUE', 'FALSE', 'POSX', 'NEGX', 'PI'
    ];

    constants.forEach(constant => {
      it(`should tokenize ${constant} constant`, () => {
        const result = tokenizeLine(constant);
        assert.ok(hasScope(result, 'constant.language'), `Should recognize ${constant}`);
      });
    });
  });

  describe('Configuration Constants Coverage', () => {
    const configConstants = [
      'CHIPVER', 'CLKMODE', '_CLKMODE', 'CLKFREQ', '_CLKFREQ',
      'CLKSET', '_XINFREQ', '_STACK', '_FREE',
      'RCFAST', 'RCSLOW', 'XINPUT',
      'XTAL1', 'XTAL2', 'XTAL3',
      'PLL1X', 'PLL2X', 'PLL4X', 'PLL8X', 'PLL16X'
    ];

    configConstants.forEach(constant => {
      it(`should tokenize ${constant} configuration constant`, () => {
        const result = tokenizeLine(constant);
        assert.ok(
          hasScope(result, 'keyword.control.configuration') ||
          hasScope(result, 'constant.language'),
          `Should recognize ${constant}`
        );
      });
    });
  });

  describe('Operators Coverage', () => {
    describe('Unary Operators', () => {
      const unaryOps = [
        '!!', 'NOT', '!', '-',
        'ABS', 'FABS', 'ENCOD', 'DECOD', 'BMASK', 'ONES',
        'SQRT', 'FSQRT', 'QLOG', 'QEXP'
      ];

      unaryOps.forEach(op => {
        it(`should tokenize unary operator ${op}`, () => {
          const result = tokenizeLine(`${op} value`);
          assert.ok(hasScope(result, 'keyword.operator'), `Should recognize ${op}`);
        });
      });
    });

    describe('Binary Operators', () => {
      const binaryOps = [
        'SAR', 'ROR', 'ROL', 'REV', 'ZEROX', 'SIGNX',
        'SCA', 'SCAS', 'FRAC',
        'AND', 'OR', 'XOR'
      ];

      binaryOps.forEach(op => {
        it(`should tokenize binary operator ${op}`, () => {
          const result = tokenizeLine(`a ${op} b`);
          assert.ok(hasScope(result, 'keyword.operator'), `Should recognize ${op}`);
        });
      });
    });
  });

  describe('Storage Types Coverage', () => {
    const storageTypes = ['BYTE', 'WORD', 'LONG', 'BYTEFIT', 'WORDFIT'];

    storageTypes.forEach(type => {
      it(`should tokenize ${type} storage type`, () => {
        const result = tokenizeLine(`  ${type}`);
        assert.ok(hasScope(result, 'storage.type'), `Should recognize ${type}`);
      });
    });
  });

  describe('Built-in Functions Coverage', () => {
    describe('COG Functions', () => {
      const cogFunctions = [
        'COGCHK', 'COGID', 'COGINIT', 'COGSPIN', 'COGSTOP'
      ];

      cogFunctions.forEach(func => {
        it(`should tokenize ${func} function`, () => {
          const result = tokenizeLine(func);
          assert.ok(hasScope(result, 'support.function'), `Should recognize ${func}`);
        });
      });
    });

    describe('PIN Functions', () => {
      const pinFunctions = [
        'PINW', 'PINWRITE', 'PINL', 'PINLOW', 'PINH', 'PINHIGH',
        'PINT', 'PINTOGGLE', 'PINF', 'PINFLOAT', 'PINR', 'PINREAD',
        'PINSTART', 'PINCLEAR', 'WRPIN', 'WXPIN', 'WYPIN',
        'AKPIN', 'RDPIN', 'RQPIN'
      ];

      pinFunctions.forEach(func => {
        it(`should tokenize ${func} function`, () => {
          const result = tokenizeLine(func);
          assert.ok(hasScope(result, 'support.function'), `Should recognize ${func}`);
        });
      });
    });

    describe('Memory Functions', () => {
      const memFunctions = [
        'BYTEMOVE', 'BYTEFILL', 'WORDMOVE', 'WORDFILL',
        'LONGMOVE', 'LONGFILL', 'GETREGS', 'SETREGS'
      ];

      memFunctions.forEach(func => {
        it(`should tokenize ${func} function`, () => {
          const result = tokenizeLine(func);
          assert.ok(hasScope(result, 'support.function'), `Should recognize ${func}`);
        });
      });
    });

    describe('Timing Functions', () => {
      const timingFunctions = [
        'GETCT', 'POLLCT', 'WAITCT', 'GETMS', 'GETSEC',
        'WAITMS', 'WAITUS'
      ];

      timingFunctions.forEach(func => {
        it(`should tokenize ${func} function`, () => {
          const result = tokenizeLine(func);
          assert.ok(hasScope(result, 'support.function'), `Should recognize ${func}`);
        });
      });
    });
  });

  describe('PASM Instructions Coverage', () => {
    describe('Branch Instructions', () => {
      const branchInstructions = [
        'CALL', 'CALLA', 'CALLB', 'CALLD', 'CALLPA', 'CALLPB',
        'RET', 'RETA', 'RETB',
        'JMP', 'JMPREL', 'JNINT', 'JINT',
        'TJZ', 'TJNZ', 'TJF', 'TJNF', 'TJS', 'TJNS', 'TJV',
        'DJZ', 'DJNZ', 'DJF', 'DJNF'
      ];

      branchInstructions.forEach(instr => {
        it(`should tokenize PASM ${instr} instruction`, () => {
          const result = tokenizeLine(`  ${instr}  dest, source`);
          assert.ok(hasScope(result, 'keyword.pasm'), `Should recognize ${instr}`);
        });
      });
    });

    describe('Math/Logic Instructions', () => {
      const mathInstructions = [
        'ADD', 'ADDS', 'ADDX', 'ADDSX',
        'SUB', 'SUBS', 'SUBX', 'SUBSX',
        'MUL', 'MULS',
        'AND', 'ANDN', 'OR', 'XOR', 'NOT',
        'ABS', 'NEG', 'NEGC', 'NEGNC', 'NEGZ', 'NEGNZ',
        'SHL', 'SHR', 'SAR', 'ROR', 'ROL',
        'MINS', 'MAXS', 'MIN', 'MAX'
      ];

      mathInstructions.forEach(instr => {
        it(`should tokenize PASM ${instr} instruction`, () => {
          const result = tokenizeLine(`  ${instr}  dest, source`);
          assert.ok(hasScope(result, 'keyword.pasm'), `Should recognize ${instr}`);
        });
      });
    });

    describe('Hub RAM Instructions', () => {
      const hubInstructions = [
        'RDBYTE', 'RDWORD', 'RDLONG',
        'WRBYTE', 'WRWORD', 'WRLONG', 'WMLONG',
        'POPA', 'POPB', 'PUSHA', 'PUSHB'
      ];

      hubInstructions.forEach(instr => {
        it(`should tokenize PASM ${instr} instruction`, () => {
          const result = tokenizeLine(`  ${instr}  dest, source`);
          assert.ok(hasScope(result, 'keyword.pasm'), `Should recognize ${instr}`);
        });
      });
    });
  });

  describe('COG Register Names Coverage', () => {
    const cogRegisters = [
      'PR0', 'PR1', 'PR2', 'PR3', 'PR4', 'PR5', 'PR6', 'PR7',
      'IJMP1', 'IJMP2', 'IJMP3',
      'IRET1', 'IRET2', 'IRET3',
      'PA', 'PB', 'PTRA', 'PTRB',
      'DIRA', 'DIRB', 'INA', 'INB', 'OUTA', 'OUTB'
    ];

    cogRegisters.forEach(reg => {
      it(`should tokenize ${reg} register name`, () => {
        const result = tokenizeLine(reg);
        assert.ok(hasScope(result, 'constant.language.cog-register'), `Should recognize ${reg}`);
      });
    });
  });

  describe('Debug Statement Coverage', () => {
    it('should tokenize debug statement', () => {
      const result = tokenizeLine('debug("value=", udec(x))');
      assert.ok(hasScope(result, 'meta.debug'), 'Should recognize debug statement');
    });

    it('should tokenize debug with window name', () => {
      const result = tokenizeLine('debug[mywindow]("test")');
      assert.ok(hasScope(result, 'meta.debug'), 'Should recognize debug with window');
    });
  });

  describe('Object Declaration Coverage', () => {
    it('should tokenize object declaration', () => {
      const result = tokenizeLine('  ser : "com.serial.terminal"');
      assert.ok(hasScope(result, 'entity.name.object'), 'Should recognize object name');
      assert.ok(hasScope(result, 'meta.object.filename'), 'Should recognize filename');
    });

    it('should tokenize object array declaration', () => {
      const result = tokenizeLine('  drivers[4] : "driver.sys"');
      assert.ok(hasScope(result, 'entity.name.object'), 'Should recognize object array');
    });
  });

  describe('Variable Declaration Coverage', () => {
    it('should tokenize BYTE variable', () => {
      const result = tokenizeLine('  BYTE buffer');
      assert.ok(hasScope(result, 'storage.type'), 'Should recognize BYTE type');
      assert.ok(hasScope(result, 'variable.name'), 'Should recognize variable name');
    });

    it('should tokenize WORD array', () => {
      const result = tokenizeLine('  WORD data[100]');
      assert.ok(hasScope(result, 'storage.type'), 'Should recognize WORD type');
    });

    it('should tokenize LONG variable', () => {
      const result = tokenizeLine('  LONG counter');
      assert.ok(hasScope(result, 'storage.type'), 'Should recognize LONG type');
    });
  });

  describe('Edge Cases and Complex Constructs', () => {
    it('should handle nested block comments', () => {
      let ruleStack = vsctm.INITIAL;
      let result = tokenizeLine('{ outer { inner } still in comment }', ruleStack);
      assert.ok(hasScope(result, 'comment.block'), 'Should handle nested comments');
    });

    it('should handle method declaration with parameters', () => {
      const result = tokenizeLine('PUB start(pin, baud) | temp, i');
      assert.ok(hasScope(result, 'keyword.block.pub'), 'Should recognize PUB');
    });

    it('should handle inline PASM block', () => {
      let ruleStack = vsctm.INITIAL;

      let result = tokenizeLine('  ORG', ruleStack);
      assert.ok(hasScope(result, 'storage.modifier'), 'Should recognize ORG');
    });

    it('should handle array indexing', () => {
      const result = tokenizeLine('buffer[index]');
      assert.ok(hasScope(result, 'meta.array.index'), 'Should recognize array index');
    });

    it('should handle constant assignment', () => {
      let ruleStack = vsctm.INITIAL;
      tokenizeLine('CON', ruleStack);
      const result = tokenizeLine('  BAUD_RATE = 115200');
      assert.ok(hasScope(result, 'entity.name.constant'), 'Should recognize constant name');
    });
  });
});
