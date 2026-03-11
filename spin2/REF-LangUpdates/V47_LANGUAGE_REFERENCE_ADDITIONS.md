# V47 Language Reference Additions

This document lists new language features added in PNut v47 that should be added to the Spin2/PASM2 language reference.

---

## Preprocessor Directives

### #DEFINE

**Category:** Preprocessor

**Syntax:**
```spin2
#DEFINE symbol
```

**Description:**
Defines a preprocessor symbol. The symbol can later be tested with `#IFDEF` or `#IFNDEF`.

**Example:**
```spin2
#DEFINE DEBUG_MODE
#DEFINE USE_SERIAL
```

---

### #UNDEF

**Category:** Preprocessor

**Syntax:**
```spin2
#UNDEF symbol
```

**Description:**
Undefines a previously defined preprocessor symbol.

**Example:**
```spin2
#DEFINE FEATURE_X
' ... code using FEATURE_X ...
#UNDEF FEATURE_X
```

---

### #IFDEF

**Category:** Preprocessor

**Syntax:**
```spin2
#IFDEF symbol
    ' code compiled if symbol is defined
#ENDIF
```

**Description:**
Conditional compilation block. The enclosed code is compiled only if the specified symbol is defined.

**Example:**
```spin2
#DEFINE DEBUG_MODE

PUB main()
#IFDEF DEBUG_MODE
    debug("Debug mode enabled")
#ENDIF
```

---

### #IFNDEF

**Category:** Preprocessor

**Syntax:**
```spin2
#IFNDEF symbol
    ' code compiled if symbol is NOT defined
#ENDIF
```

**Description:**
Conditional compilation block. The enclosed code is compiled only if the specified symbol is NOT defined.

**Example:**
```spin2
#IFNDEF RELEASE_BUILD
    ' Include debug code
    debug("Development build")
#ENDIF
```

---

### #ELSEIFDEF

**Category:** Preprocessor

**Syntax:**
```spin2
#IFDEF symbol1
    ' code for symbol1
#ELSEIFDEF symbol2
    ' code for symbol2 (when symbol1 not defined)
#ENDIF
```

**Description:**
Else-if branch that tests if an alternative symbol is defined.

---

### #ELSEIFNDEF

**Category:** Preprocessor

**Syntax:**
```spin2
#IFDEF symbol1
    ' code for symbol1
#ELSEIFNDEF symbol2
    ' code when symbol1 not defined AND symbol2 not defined
#ENDIF
```

**Description:**
Else-if branch that tests if an alternative symbol is NOT defined.

---

### #ELSE

**Category:** Preprocessor

**Syntax:**
```spin2
#IFDEF symbol
    ' code if symbol defined
#ELSE
    ' code if symbol not defined
#ENDIF
```

**Description:**
Else branch for conditional compilation.

**Example:**
```spin2
#IFDEF USE_SERIAL
    serial.start(115200)
#ELSE
    ' Use default output
#ENDIF
```

---

### #ENDIF

**Category:** Preprocessor

**Syntax:**
```spin2
#ENDIF
```

**Description:**
Ends a conditional compilation block started by `#IFDEF` or `#IFNDEF`.

---

### Preprocessor Nesting

**Maximum Nesting:** 8 levels

**Example:**
```spin2
#IFDEF LEVEL1
    #IFDEF LEVEL2
        #IFDEF LEVEL3
            ' Up to 8 levels deep
        #ENDIF
    #ENDIF
#ENDIF
```

---

## New Spin2 Methods - Multitasking

### TASKSPIN

**Category:** Multitasking

**Syntax:**
```spin2
TASKSPIN(task, method(params), stackaddr)
```

**Parameters:**
- `task` - Task number (0-31)
- `method(params)` - Method to execute with its parameters
- `stackaddr` - Address of stack memory for the task

**Description:**
Starts a new task running the specified method. Tasks share the cog's interpreter but have independent stacks and execution contexts.

**Example:**
```spin2
VAR
    long stack[100]

PUB main()
    TASKSPIN(1, background_task(), @stack)
    repeat
        ' main loop
        TASKNEXT()

PRI background_task()
    repeat
        ' background processing
        TASKNEXT()
```

---

### TASKSTOP

**Category:** Multitasking

**Syntax:**
```spin2
TASKSTOP(task)
```

**Parameters:**
- `task` - Task number (0-31)

**Description:**
Permanently stops a task. The task cannot be resumed after stopping.

**Example:**
```spin2
TASKSTOP(1)   ' Stop task 1
```

---

### TASKHALT

**Category:** Multitasking

**Syntax:**
```spin2
TASKHALT(task)
```

**Parameters:**
- `task` - Task number (0-31)

**Description:**
Temporarily halts a task. The task can be resumed with `TASKCONT`.

**Example:**
```spin2
TASKHALT(2)   ' Pause task 2
```

---

### TASKCONT

**Category:** Multitasking

**Syntax:**
```spin2
TASKCONT(task)
```

**Parameters:**
- `task` - Task number (0-31)

**Description:**
Continues a halted task that was paused with `TASKHALT`.

**Example:**
```spin2
TASKCONT(2)   ' Resume task 2
```

---

### TASKCHK

**Category:** Multitasking

**Syntax:**
```spin2
result := TASKCHK(task)
```

**Parameters:**
- `task` - Task number (0-31)

**Returns:**
- Non-zero if task is running
- Zero if task is stopped

**Description:**
Checks if a task is currently running.

**Example:**
```spin2
if TASKCHK(1)
    debug("Task 1 is running")
```

---

### TASKID

**Category:** Multitasking

**Syntax:**
```spin2
id := TASKID()
```

**Returns:**
- Current task ID (0-31)

**Description:**
Returns the task number of the currently executing task.

**Example:**
```spin2
PRI my_task() | my_id
    my_id := TASKID()
    debug("I am task ", udec(my_id))
```

---

### TASKNEXT

**Category:** Multitasking

**Syntax:**
```spin2
TASKNEXT()
```

**Description:**
Yields execution to the next task. This is a cooperative multitasking mechanism - tasks must call TASKNEXT to allow other tasks to run.

**Example:**
```spin2
PRI worker_task()
    repeat
        ' Do some work
        process_data()
        TASKNEXT()   ' Let other tasks run
```

---

## PASM2 Enhancements

### Conditional DEBUG

**Category:** Debug

**Syntax:**
```pasm
IF_condition DEBUG(...)
```

**Description:**
DEBUG instructions in PASM can now be prefixed with condition codes. The DEBUG executes only if the condition is met.

**Example:**
```pasm
DAT     org
        mov     x, #5
        cmp     x, #10    wc
if_c    DEBUG("x < 10")       ' Only if carry set
if_nc   DEBUG("x >= 10")      ' Only if carry clear
```

---

## Summary Table

| Feature | Type | Description |
|---------|------|-------------|
| #DEFINE | Preprocessor | Define symbol |
| #UNDEF | Preprocessor | Undefine symbol |
| #IFDEF | Preprocessor | Conditional if defined |
| #IFNDEF | Preprocessor | Conditional if not defined |
| #ELSEIFDEF | Preprocessor | Else-if defined |
| #ELSEIFNDEF | Preprocessor | Else-if not defined |
| #ELSE | Preprocessor | Else branch |
| #ENDIF | Preprocessor | End conditional |
| TASKSPIN | Method | Start a task |
| TASKSTOP | Method | Stop a task |
| TASKHALT | Method | Halt a task |
| TASKCONT | Method | Continue a task |
| TASKCHK | Method | Check task status |
| TASKID | Method | Get current task ID |
| TASKNEXT | Method | Yield to next task |
| IF_x DEBUG | PASM | Conditional DEBUG |
