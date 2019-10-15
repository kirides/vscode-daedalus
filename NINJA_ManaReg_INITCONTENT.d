const string NINJA_MANAREG_VERSION = "ManaReg 1.1.0";
const string NINJA_MANAREG_INI = "NINJA_MANAREG";
const string NINJA_MANAREG_INI_THRESHOLD = "THRESHOLD";
const string NINJA_MANAREG_INI_DIVISOR = "DIVISOR";

const int DEFAULT_NINJA_MANAREG_MANA_THRESHOLD = 50;
const int DEFAULT_NINJA_MANAREG_MAX_MANA_DIVISOR = 50;
const int DEFAULT_NINJA_MANAREG_TICKRATE = 2000;

var int Ninja_ManaReg_Mana_Threshold;
var int Ninja_ManaReg_Max_Mana_Divisor;

func void Ninja_ManaReg_Regeneration() {
    // Not during loading
    if (!Hlp_IsValidNpc(hero)) { return; };
    // Only in-game
    if (!MEM_Game.timestep) { return; };
    // Only in a certain interval
    var int delayTimer; delayTimer += MEM_Timer.frameTime;
    if (delayTimer < DEFAULT_NINJA_MANAREG_TICKRATE) { return; };
	
    delayTimer -= DEFAULT_NINJA_MANAREG_TICKRATE;
    if (hero.attribute[ATR_MANA_MAX] >= Ninja_ManaReg_Mana_Threshold) {
        if (hero.attribute[ATR_MANA] < hero.attribute[ATR_MANA_MAX]) {
            var int menge; menge = (hero.attribute[ATR_MANA_MAX] + (Ninja_ManaReg_Max_Mana_Divisor/2)) / Ninja_ManaReg_Max_Mana_Divisor;
            Npc_ChangeAttribute(hero, ATR_MANA, menge);
		};
    };
};

func void Ninja_ManaReg_ApplyINI() {
	
	var string ini_threshold; ini_threshold = MEM_GetGothOpt(NINJA_MANAREG_INI, NINJA_MANAREG_INI_THRESHOLD);
	var string ini_divisor; ini_divisor = MEM_GetGothOpt(NINJA_MANAREG_INI, NINJA_MANAREG_INI_DIVISOR);

	Ninja_ManaReg_Mana_Threshold = DEFAULT_NINJA_MANAREG_MANA_THRESHOLD;
	Ninja_ManaReg_Max_Mana_Divisor = DEFAULT_NINJA_MANAREG_MAX_MANA_DIVISOR;
	
	MEM_Info(
		ConcatStrings(
			ConcatStrings(NINJA_MANAREG_VERSION, // Some comments
			": THRESHOLD FROM INI = "), ini_threshold));
	MEM_Info(ConcatStrings(ConcatStrings(NINJA_MANAREG_VERSION, ": DIVISOR FROM INI = "), ini_divisor));
	
	if (!Hlp_StrCmp(ini_threshold, "")) {
		Ninja_ManaReg_Mana_Threshold = STR_ToInt(ini_threshold);
	};
	
	
	if (!Hlp_StrCmp(ini_divisor, "")) {
		Ninja_ManaReg_Max_Mana_Divisor = STR_ToInt(ini_divisor);
	};
};

/*
 * Init-function called by Ninja
 */
func void Ninja_ManaReg_Init() {
	MEM_Info(ConcatStrings(ConcatStrings("Initialize ", NINJA_MANAREG_VERSION), "."));
	
	// Initialize Ikarus
	MEM_InitAll();
	
	MEM_Info(ConcatStrings(ConcatStrings(NINJA_MANAREG_VERSION, ": " ), "Applying Gothic.INI."));
	Ninja_ManaReg_ApplyINI();
	MEM_Info(ConcatStrings(ConcatStrings(NINJA_MANAREG_VERSION, ": " ), "Gothic.INI applied"));
	
    MEM_Info(ConcatStrings(ConcatStrings(NINJA_MANAREG_VERSION, ": " ), "Hooking into oCGame__Render."));
	HookEngineF(oCGame__Render, 7, Ninja_ManaReg_Regeneration);
    MEM_Info(ConcatStrings(ConcatStrings(NINJA_MANAREG_VERSION, ": " ), "Hooking into oCGame__Render finished."));

    MEM_Info(ConcatStrings(NINJA_MANAREG_VERSION, " was initialized successfully."));
};
