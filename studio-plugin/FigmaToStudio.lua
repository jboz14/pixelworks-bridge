-- Figma -> Studio (Pixelworks)
-- Builds a real ScreenGui in StarterGui from the frame you sent from the Figma plugin.
-- No loader script: you get normal Frames, TextLabels, UICorner, UIStroke, UIGradient, UIListLayout...
-- Install: Studio > Plugins tab > "Plugins Folder", drop this file in, restart Studio.

local HttpService = game:GetService("HttpService")
local StarterGui = game:GetService("StarterGui")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local RunService = game:GetService("RunService")
local Selection = game:GetService("Selection")

if RunService:IsRunning() then
	return
end

local VERSION = "v0.13.7 (updated_6_20)" -- same number as the Figma plugin and the zip name, so you can tell if they match
local BASE = "" -- set from the Connection box: https://your-bridge.onrender.com/figma-bridge
local authHeader = nil -- "Basic ..." built from the username and password

----------------------------------------------------------------------
-- settings (kept between sessions)
----------------------------------------------------------------------
local MODES = { "pixels", "stretch" }
local MODE_TEXT = {
	pixels = "Size: exact Figma size (recommended)",
	stretch = "Size: stretch to screen",
}
local mode = plugin:GetSetting("figmaMode")
if not MODE_TEXT[mode] then
	mode = "pixels" -- also replaces the old "fit" setting, which is gone
end
local TEXT_SCALES = { 0.9, 1, 1.1, 1.25, 1.5, 0.8 }
local textScale = tonumber(plugin:GetSetting("figmaTextScale")) or 1
if not table.find(TEXT_SCALES, textScale) then
	textScale = 1
end
local runEffects = plugin:GetSetting("figmaRunEffects") == true -- off by default: the effects script can move layers around while playing
local tiledBg = plugin:GetSetting("figmaTiledBg") ~= false
local SIZE_FACTORS = { 1, 0.9, 0.8, 0.7, 0.6, 0.5, 1.25, 1.5 }
local sizeFactor = tonumber(plugin:GetSetting("figmaSizeFactor")) or 1
if not table.find(SIZE_FACTORS, sizeFactor) then
	sizeFactor = 1
end
local lastVersion = 0

----------------------------------------------------------------------
-- fonts: Figma family name -> Roblox font (first match wins)
----------------------------------------------------------------------
local FAMILY_FONTS = {
	{ "fredoka", "FredokaOne" },
	{ "lilita", "FredokaOne" },
	{ "baloo", "FredokaOne" },
	{ "paytone", "FredokaOne" },
	{ "titan one", "FredokaOne" },
	{ "chewy", "FredokaOne" },
	{ "press start", "Arcade" },
	{ "pixel", "Arcade" },
	{ "creepster", "Creepster" },
	{ "fondamento", "Fondamento" },
	{ "grenze", "GrenzeGotisch" },
	{ "luckiest", "LuckiestGuy" },
	{ "bangers", "Bangers" },
	{ "permanent marker", "PermanentMarker" },
	{ "indie flower", "IndieFlower" },
	{ "patrick", "PatrickHand" },
	{ "amatic", "AmaticSC" },
	{ "oswald", "Oswald" },
	{ "nunito", "Nunito" },
	{ "ubuntu", "Ubuntu" },
	{ "merriweather", "Merriweather" },
	{ "michroma", "Michroma" },
	{ "jura", "Jura" },
	{ "titillium", "TitilliumWeb" },
	{ "roboto mono", "RobotoMono" },
	{ "mono", "Code" },
	{ "code", "Code" },
	{ "roboto", "Roboto" },
	{ "source sans", "SourceSans" },
	{ "josefin", "JosefinSans" },
	{ "kalam", "Kalam" },
	{ "special elite", "SpecialElite" },
	{ "sarpanch", "Sarpanch" },
	{ "denk", "DenkOne" },
}

-- Some Roblox fonts draw much smaller than the Figma font at the same number (Arcade vs Press Start 2P is the big one).
-- The text may grow up to size x this number to match how big it looked in Figma, and is then shrunk until it fits its box.
local FONT_BOOST = {
	Arcade = 2.0,
	Code = 1.1,
	Michroma = 1.0,
	Bangers = 1.1,
	LuckiestGuy = 1.05,
	FredokaOne = 1.1,
	PermanentMarker = 1.05,
	Creepster = 1.1,
	IndieFlower = 1.2,
	PatrickHand = 1.2,
	Amatic = 1.4,
	AmaticSC = 1.4,
	Kalam = 1.1,
}

-- largest whole text size (up to cap) at which the text fits its box; nil when text could not be measured
local TextServiceFit = game:GetService("TextService")
local function fitTextSize(text, font, cap, boxW, boxH, wrapped, lines)
	if boxW < 4 or boxH < 4 or text == "" then
		return nil
	end
	local size = math.clamp(math.floor(cap + 0.5), 6, 100)
	while size > 6 do
		local ok, bounds = pcall(function()
			return TextServiceFit:GetTextSize(text, size, font, Vector2.new(wrapped and boxW or 100000, 100000))
		end)
		if not ok then
			return nil
		end
		-- long text may use `lines` lines even when the Figma box is only one line tall (Figma lets text spill out of its box)
		local allowedH = math.max(boxH, lines and size * 1.3 * lines or 0)
		if bounds.Y <= allowedH + 1 and (wrapped or bounds.X <= boxW + 1) then
			return size, bounds.Y
		end
		size -= 1
	end
	return 6, nil
end

local function tryFont(name)
	local ok, f = pcall(function()
		return Enum.Font[name]
	end)
	if ok then
		return f
	end
	return nil
end

local function pickFont(family, style)
	local fam = string.lower(family or "")
	local sty = string.lower(style or "")
	for _, pair in ipairs(FAMILY_FONTS) do
		if string.find(fam, pair[1], 1, true) then
			local f = tryFont(pair[2])
			if f then
				return f
			end
		end
	end
	-- sans families: pick the weight from the style name
	if string.find(sty, "black") or string.find(sty, "heavy") then
		return Enum.Font.GothamBlack
	elseif string.find(sty, "bold") then
		return Enum.Font.GothamBold
	elseif string.find(sty, "medium") or string.find(sty, "semi") then
		return Enum.Font.GothamMedium
	end
	return Enum.Font.Gotham
end

----------------------------------------------------------------------
-- small helpers
----------------------------------------------------------------------
-- effect tags (@glow, @hoverlift(distance=4) ...) -> the attributes the UIEffects module reads:
--   Fx = "glow|hoverlift"   and   Fx_<name> = '{"distance":4}'
-- behaviour tags (@button, @close, @open ...) are not effects, they stay in FigmaTags only
local BEHAVIOR = {
	button = true, close = true, panel = true, open = true, toggle = true,
	tab = true, tabgroup = true, active = true, scroll = true, image = true, ignore = true,
	-- Roblox UI objects from the Figma plugin's UI tab: built as real instances by applyUiTags, not played as effects
	uigui = true, uiframe = true, uilabel = true, uiinput = true,
	uicorner = true, uistroke = true, uigradient = true, uipadding = true, uishadow = true,
	uilist = true, uigrid = true, uipage = true, uitable = true, uiflex = true,
	uiaspect = true, uiscale = true, uisize = true, uitextsize = true, uiparticle = true,
}

local function parseValue(v)
	v = string.gsub(v, "^%s+", "")
	v = string.gsub(v, "%s+$", "")
	local n = tonumber(v)
	if n ~= nil then
		return n
	elseif v == "true" then
		return true
	elseif v == "false" then
		return false
	end
	return v
end

local function parseTag(tag)
	local name = string.match(tag, "^@(%a+)")
	if not name then
		return nil, nil
	end
	local inside = string.match(tag, "%((.*)%)$")
	local params = nil
	if inside then
		params = {}
		for pair in string.gmatch(inside, "[^,]+") do
			local k, v = string.match(pair, "^%s*([%w_]+)%s*=%s*(.-)%s*$")
			if k then
				params[k] = parseValue(v)
			end
		end
	end
	return string.lower(name), params
end

local fxSeen = {} -- effect name -> true, for the "these effects have no code" note after an import
local currentImages = {} -- Figma layer id -> Roblox asset id of its uploaded picture (also "fxpic:<effect>" for your own particle pictures)
local resolveImageId -- defined below
local PARTICLE_KINDS = { embers = true, snow = true, fireflies = true, coins = true, hearts = true, rain = true, leaves = true, smoke = true, shootingstar = true, confetti = true, bubbles = true }

-- a particle's own picture: the id typed in its Settings, or the PNG uploaded in "Use my own pictures" (sent to Roblox with the layers)
local function withParticlePicture(name, params)
	if not PARTICLE_KINDS[name] then
		return params
	end
	local raw = params and params.imageid
	local id = ""
	if raw ~= nil then
		id = string.gsub(type(raw) == "number" and string.format("%.0f", raw) or tostring(raw), "%D", "")
	end
	if id == "" and currentImages["fxpic:" .. name] then
		id = string.gsub(tostring(currentImages["fxpic:" .. name]), "%D", "")
	end
	if id == "" then
		return params
	end
	params = params or {}
	params.imageid = tostring(resolveImageId(id)) -- a string: long ids lose digits as numbers
	return params
end

local function applyEffectAttributes(inst, tags, skip)
	local names = {}
	for _, tag in ipairs(tags) do
		local name, params = parseTag(tag)
		if name and not BEHAVIOR[name] and not (skip and skip[name]) then
			-- the app's own UIEffects stretches a halo ring into a big oval on wide rows, so halo is played by UIEffectsExtra under another name
			if name == "halo" then
				name = "figmahalo"
			end
			fxSeen[name] = true
			params = withParticlePicture(name, params)
			if PARTICLE_KINDS[name] and params and tostring(params.imageid or "") ~= "" then
				name = "pic" .. name
			end
			table.insert(names, name)
			if params and next(params) ~= nil then
				inst:SetAttribute("Fx_" .. name, HttpService:JSONEncode(params))
			end
		end
	end
	if #names > 0 then
		local old = inst:GetAttribute("Fx")
		if type(old) == "string" and old ~= "" then
			table.insert(names, 1, old)
		end
		inst:SetAttribute("Fx", table.concat(names, "|"))
	end
	return #names
end

-- @bg(style=image,store=123,size=24,opacity=0.7) -> a tiled picture drawn right now (not only when the game runs)
local function findImageBackground(tags)
	if not tags then
		return nil
	end
	for _, tag in ipairs(tags) do
		local name, params = parseTag(tag)
		if name == "bg" and params and string.lower(tostring(params.style or "")) == "image" then
			local id = string.gsub(tostring(params.store or params.image or ""), "%D", "")
			if id ~= "" then
				local size = tonumber(params.size) or 24
				local opacity = tonumber(params.opacity) or 1
				return { id = id, tile = math.max(8, size * 4), opacity = math.clamp(opacity, 0.05, 1) }
			end
		end
	end
	return nil
end

-- Creator Store "images" are often Decal ids. An ImageLabel needs the Image id inside the Decal, so look it up (falls back to the same id)
local InsertService = game:GetService("InsertService")
local imageIdCache = {}
function resolveImageId(id)
	if imageIdCache[id] then
		return imageIdCache[id]
	end
	local resolved = id
	pcall(function()
		local model = InsertService:LoadAsset(tonumber(id))
		local d = model:FindFirstChildWhichIsA("Decal", true) or model:FindFirstChildWhichIsA("Texture", true)
		if d then
			local n = string.match(tostring(d.Texture), "(%d+)")
			if n then
				resolved = n
			end
		end
		model:Destroy()
	end)
	imageIdCache[id] = resolved
	return resolved
end

-- text effects (textgradient, textwave...) only work on a TextLabel. If the tag sits on a frame, it moves to the first text inside it.
local TEXT_FX = {
	textwave = true, textshake = true, textpop = true, textrainbow = true, textglitch = true,
	textgradient = true, textglow = true, typewriter = true, outline = true, font = true,
}
-- light effects that sit behind a layer: they need a plain frame as parent, not an auto-layout list
local NEEDS_PLAIN_PARENT = { rays = true, aura = true, halo = true, stars = true, orbit = true }

local function splitTags(tags)
	local plain, text, needsPlain = {}, {}, false
	for _, tag in ipairs(tags or {}) do
		local name = parseTag(tag)
		if name and TEXT_FX[name] then
			table.insert(text, tag)
		else
			table.insert(plain, tag)
		end
		if name and NEEDS_PLAIN_PARENT[name] then
			needsPlain = true
		end
	end
	return plain, text, needsPlain
end

local function rgb(c)
	return Color3.fromRGB(c[1], c[2], c[3])
end

local function clamp01(v)
	if v < 0 then
		return 0
	elseif v > 1 then
		return 1
	end
	return v
end

local function transparency(alpha, opacity)
	return clamp01(1 - (alpha or 1) * (opacity or 1))
end

-- pixel sizes are multiplied by the "Screen size" choice (real sizes, so effects and layouts keep working, unlike a UIScale)
local function S(v)
	if mode == "pixels" then
		return v * sizeFactor
	end
	return v
end

-- "stretch" sizes everything in scale, "pixels" in offset
local function sizeUDim2(w, h, pw, ph)
	if mode == "pixels" then
		return UDim2.fromOffset(S(w), S(h))
	end
	return UDim2.fromScale(w / pw, h / ph)
end

local function posUDim2(x, y, pw, ph)
	if mode == "pixels" then
		return UDim2.fromOffset(S(x), S(y))
	end
	return UDim2.fromScale(x / pw, y / ph)
end

local function addGradient(inst, fill, nodeOpacity)
	local stops = fill.stops
	local colors, alphas = {}, {}
	local needAlpha = (nodeOpacity or 1) < 1
	for i, s in ipairs(stops) do
		colors[i] = ColorSequenceKeypoint.new(clamp01(s.p), rgb(s.c))
		alphas[i] = NumberSequenceKeypoint.new(clamp01(s.p), transparency(s.a, nodeOpacity))
		if (s.a or 1) < 1 then
			needAlpha = true
		end
	end
	if #colors < 2 then
		return
	end
	-- sequences need a keypoint at 0 and 1
	if colors[1].Time > 0 then
		table.insert(colors, 1, ColorSequenceKeypoint.new(0, colors[1].Value))
		table.insert(alphas, 1, NumberSequenceKeypoint.new(0, alphas[1].Value))
	end
	if colors[#colors].Time < 1 then
		table.insert(colors, ColorSequenceKeypoint.new(1, colors[#colors].Value))
		table.insert(alphas, NumberSequenceKeypoint.new(1, alphas[#alphas].Value))
	end
	local g = Instance.new("UIGradient")
	g.Color = ColorSequence.new(colors)
	if needAlpha then
		g.Transparency = NumberSequence.new(alphas)
	end
	g.Rotation = fill.rot or 90
	g.Parent = inst
end

local H_ALIGN = { MIN = Enum.HorizontalAlignment.Left, CENTER = Enum.HorizontalAlignment.Center, MAX = Enum.HorizontalAlignment.Right }
local V_ALIGN = { MIN = Enum.VerticalAlignment.Top, CENTER = Enum.VerticalAlignment.Center, MAX = Enum.VerticalAlignment.Bottom }
local TEXT_X = { LEFT = Enum.TextXAlignment.Left, CENTER = Enum.TextXAlignment.Center, RIGHT = Enum.TextXAlignment.Right, JUSTIFIED = Enum.TextXAlignment.Left }
local TEXT_Y = { TOP = Enum.TextYAlignment.Top, CENTER = Enum.TextYAlignment.Center, BOTTOM = Enum.TextYAlignment.Bottom }

----------------------------------------------------------------------
-- building one layer (and its children)
----------------------------------------------------------------------
-- Figma layer names carry effect tags ("Shop @shadow @border"). Roblox names should be clean; the tags stay in the FigmaTags attribute.
local function cleanName(n, fallback)
	local c = string.gsub(tostring(n or ""), "%s*@%S+", "")
	c = string.gsub(c, "^%s+", "")
	c = string.gsub(c, "%s+$", "")
	if c == "" then
		return fallback or "Layer"
	end
	return c
end

-- (currentImages is declared above, before applyEffectAttributes)
local stats = { layers = 0, images = 0, fx = 0, fxCode = "" }

local uiClassFor

----------------------------------------------------------------------
-- Roblox UI objects from the Figma plugin's UI tab (@uiframe, @uicorner, @uistroke, @uilist ...)
----------------------------------------------------------------------
local UI_CLASSES = {
	uiframe = { Frame = true, CanvasGroup = true, ScrollingFrame = true, VideoFrame = true, ViewportFrame = true },
	uilabel = { ImageLabel = true, TextLabel = true },
	uiinput = { ImageButton = true, TextButton = true, TextBox = true },
}
local UI_CLASS_DEFAULT = { uiframe = "Frame", uilabel = "ImageLabel", uiinput = "ImageButton" }

-- the class a plain layer becomes: @uiframe(type=ScrollingFrame), @uilabel(type=TextLabel), @uiinput(type=TextBox) ...
function uiClassFor(tags)
	for _, tag in ipairs(tags or {}) do
		local name, params = parseTag(tag)
		local set = name and UI_CLASSES[name]
		if set then
			local want = params and tostring(params.type or "") or ""
			return set[want] and want or UI_CLASS_DEFAULT[name]
		end
	end
	return "Frame"
end

local function uiNumber(v, def, lo, hi)
	local n = tonumber(v)
	if n == nil then
		n = def
	end
	return math.clamp(n, lo, hi)
end

local function uiColor(v, def)
	local s = tostring(v or def)
	local r, g, b = string.match(s, "^#?(%x%x)(%x%x)(%x%x)")
	if not r then
		r, g, b = string.match(def, "^#?(%x%x)(%x%x)(%x%x)")
	end
	return Color3.fromRGB(tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
end

local function uiAdd(inst, class, name)
	local old = inst:FindFirstChildOfClass(class)
	if old and old.Name == name then
		return old
	end
	local o = Instance.new(class)
	o.Name = name
	o.Parent = inst
	return o
end

-- Adds the Roblox modifiers named by the layer's tags. Runs after the layer is parented and its children are built.
local function applyUiTags(inst, node, isText, inAuto)
	local seen = {}
	for _, tag in ipairs(node.tags or {}) do
		local tn, p = parseTag(tag)
		p = p or {}
		if tn == "uicorner" and inst:IsA("GuiObject") then
			local c = uiAdd(inst, "UICorner", "UICorner")
			c.CornerRadius = UDim.new(0, S(uiNumber(p.r, 8, 0, 999)))
		elseif tn == "uistroke" then
			local st = uiAdd(inst, "UIStroke", "UIStroke")
			st.Color = uiColor(p.color, "#170f33")
			st.Thickness = S(uiNumber(p.thickness, 3, 0, 30))
			st.Transparency = uiNumber(p.transparency, 0, 0, 1)
			st.ApplyStrokeMode = isText and Enum.ApplyStrokeMode.Contextual or Enum.ApplyStrokeMode.Border
		elseif tn == "uigradient" then
			local gr = inst:FindFirstChildOfClass("UIGradient") or Instance.new("UIGradient")
			gr.Name = "UIGradient"
			gr.Color = ColorSequence.new(uiColor(p.color, "#ff5c9d"), uiColor(p.color2, "#4cc9ff"))
			gr.Rotation = uiNumber(p.rotation, 90, -180, 180)
			gr.Parent = inst
			if not isText and inst.BackgroundTransparency >= 1 then
				inst.BackgroundTransparency = 0
				inst.BackgroundColor3 = Color3.new(1, 1, 1)
			end
		elseif tn == "uipadding" then
			local pad = uiNumber(p.pad, 12, 0, 200)
			local function pick(k)
				return UDim.new(0, S(uiNumber(p[k], pad, 0, 200)))
			end
			local up = uiAdd(inst, "UIPadding", "UIPadding")
			up.PaddingTop, up.PaddingRight, up.PaddingBottom, up.PaddingLeft = pick("top"), pick("right"), pick("bottom"), pick("left")
		elseif tn == "uilist" then
			if not inst:FindFirstChildOfClass("UIListLayout") then
				local l = Instance.new("UIListLayout")
				l.FillDirection = tostring(p.direction) == "horizontal" and Enum.FillDirection.Horizontal or Enum.FillDirection.Vertical
				l.Padding = UDim.new(0, S(uiNumber(p.gap, 8, 0, 100)))
				l.SortOrder = Enum.SortOrder.LayoutOrder
				local align = tostring(p.align)
				if l.FillDirection == Enum.FillDirection.Vertical then
					l.HorizontalAlignment = align == "center" and Enum.HorizontalAlignment.Center or align == "end" and Enum.HorizontalAlignment.Right or Enum.HorizontalAlignment.Left
				else
					l.VerticalAlignment = align == "center" and Enum.VerticalAlignment.Center or align == "end" and Enum.VerticalAlignment.Bottom or Enum.VerticalAlignment.Top
				end
				l.Parent = inst
			end
		elseif tn == "uigrid" then
			if not inst:FindFirstChildOfClass("UIGridLayout") then
				local g = Instance.new("UIGridLayout")
				local gap = S(uiNumber(p.gap, 8, 0, 100))
				g.CellPadding = UDim2.fromOffset(gap, gap)
				g.SortOrder = Enum.SortOrder.LayoutOrder
				local first = inst:FindFirstChildWhichIsA("GuiObject")
				if first then
					g.CellSize = first.Size
				end
				g.Parent = inst
			end
		elseif tn == "uipage" then
			local pg = uiAdd(inst, "UIPageLayout", "UIPageLayout")
			pg.Circular = tostring(p.circular) == "on"
			pg.SortOrder = Enum.SortOrder.LayoutOrder
		elseif tn == "uitable" then
			uiAdd(inst, "UITableLayout", "UITableLayout")
		elseif tn == "uiflex" and inAuto then
			local fl = uiAdd(inst, "UIFlexItem", "UIFlexItem")
			local mode = tostring(p.mode)
			pcall(function()
				fl.FlexMode = mode == "fill" and Enum.UIFlexMode.Fill or mode == "none" and Enum.UIFlexMode.None or Enum.UIFlexMode.Grow
			end)
		elseif tn == "uiaspect" then
			local ar = uiAdd(inst, "UIAspectRatioConstraint", "UIAspectRatio")
			local ratio = tonumber(p.ratio) or 0
			ar.AspectRatio = ratio > 0 and ratio or math.max(0.05, node.w / math.max(1, node.h))
		elseif tn == "uiscale" then
			local sc = uiAdd(inst, "UIScale", "UIScaleTag")
			sc.Scale = uiNumber(p.scale, 1, 0.1, 5)
		elseif tn == "uisize" then
			local sz = uiAdd(inst, "UISizeConstraint", "UISizeConstraint")
			local maxw, maxh = tonumber(p.maxw) or 0, tonumber(p.maxh) or 0
			sz.MinSize = Vector2.new(S(tonumber(p.minw) or 0), S(tonumber(p.minh) or 0))
			sz.MaxSize = Vector2.new(maxw > 0 and S(maxw) or math.huge, maxh > 0 and S(maxh) or math.huge)
		elseif tn == "uitextsize" then
			local label = inst:IsA("TextLabel") and inst or inst:FindFirstChildWhichIsA("TextLabel", true)
			if label then
				local tc = uiAdd(label, "UITextSizeConstraint", "UITextSizeConstraint")
				tc.MinTextSize = math.floor(uiNumber(p.min, 8, 1, 200))
				tc.MaxTextSize = math.floor(uiNumber(p.max, 40, 1, 400))
			end
		elseif tn == "uishadow" and not inAuto and inst.Parent and inst:IsA("GuiObject") then
			-- Roblox has no shadow object: a dark copy of the shape sits just behind the layer
			local sh = Instance.new("Frame")
			sh.Name = inst.Name .. "Shadow"
			sh.Active = false
			sh.BorderSizePixel = 0
			sh.AnchorPoint = inst.AnchorPoint
			sh.Size = inst.Size
			sh.Rotation = inst.Rotation
			sh.Position = inst.Position + UDim2.fromOffset(0, S(uiNumber(p.y, 4, -60, 60)))
			sh.BackgroundColor3 = uiColor(p.color, "#000000")
			sh.BackgroundTransparency = math.clamp(uiNumber(p.transparency, 0.6, 0, 1) + 0.1, 0, 1)
			sh.ZIndex = inst.ZIndex - 1
			sh.LayoutOrder = inst.LayoutOrder
			local corner = inst:FindFirstChildOfClass("UICorner")
			if corner then
				corner:Clone().Parent = sh
			end
			sh.Parent = inst.Parent
		elseif tn == "uiparticle" then
			-- ParticleEmitter2D has no stable instance yet: the settings are kept on the layer for your own script
			inst:SetAttribute("ParticleEmitter2D", HttpService:JSONEncode(p))
		elseif tn == "uigui" then
			inst:SetAttribute("GuiType", tostring(p.type or "ScreenGui"))
		end
		seen[tn or ""] = true
	end
end

local function build(node, parent, pw, ph, parentAuto, order)
	stats.layers = stats.layers + 1
	local fill = node.fill
	local isText = node.t == "text"
	local isImage = (not isText) and (node.t == "vector" or (fill ~= nil and fill.k == "image"))

	local isButton = false
	if not isText then
		for _, tag in ipairs(node.tags or {}) do
			if parseTag(tag) == "button" then
				isButton = true
			end
		end
	end

	local inst
	if isText then
		inst = Instance.new("TextLabel")
	elseif isButton then
		-- a @button layer is a real clickable ImageButton (a Frame cannot be clicked); its picture and background sit inside it
		inst = Instance.new("ImageButton")
		inst.AutoButtonColor = false
		if isImage and not (node.img and currentImages[node.img]) then
			stats.images = stats.images + 1
		end
	elseif isImage then
		inst = Instance.new("ImageLabel")
		if not (node.img and currentImages[node.img]) then
			stats.images = stats.images + 1
		end
	else
		inst = Instance.new(uiClassFor(node.tags))
		if inst:IsA("TextButton") or inst:IsA("ImageButton") then
			inst.AutoButtonColor = false
		end
		if inst:IsA("TextButton") or inst:IsA("TextLabel") or inst:IsA("TextBox") then
			inst.Text = ""
		end
		if inst:IsA("ScrollingFrame") then
			inst.ScrollBarThickness = 6
			inst.CanvasSize = UDim2.new()
			inst.AutomaticCanvasSize = Enum.AutomaticSize.Y
		end
	end
	inst.Name = cleanName(node.n, node.t)
	inst.BorderSizePixel = 0
	inst.Visible = node.vis ~= false
	inst.LayoutOrder = order
	inst:SetAttribute("FigmaId", node.id)
	local bgInfo = tiledBg and findImageBackground(node.tags) or nil
	local textTags, needsPlain = nil, false
	if node.tags then
		inst:SetAttribute("FigmaTags", table.concat(node.tags, " "))
		local plain, text
		plain, text, needsPlain = splitTags(node.tags)
		if isText then
			plain = node.tags
		elseif #text > 0 then
			textTags = text
		end
		stats.fx = stats.fx + applyEffectAttributes(inst, plain, (bgInfo or isText) and { bg = true } or nil) -- a background drawn inside a text layer covers the text
	end

	-- position / size (anchored at the centre so rotation turns around the middle)
	local inAuto = parentAuto and not node.abs
	local slot = nil
	if inAuto and needsPlain then
		-- the list gets a plain "Slot" frame; the layer sits inside it so its light effect has room
		slot = Instance.new("Frame")
		slot.Name = inst.Name .. "Slot"
		slot.BackgroundTransparency = 1
		slot.BorderSizePixel = 0
		slot.Size = sizeUDim2(node.w, node.h, pw, ph)
		slot.LayoutOrder = order
		slot.Visible = inst.Visible
	end
	if slot then
		inst.AnchorPoint = Vector2.new(0.5, 0.5)
		inst.Position = UDim2.fromScale(0.5, 0.5)
	elseif inAuto then
		inst.AnchorPoint = Vector2.new(0, 0)
	else
		inst.AnchorPoint = Vector2.new(0.5, 0.5)
		inst.Position = posUDim2(node.x, node.y, pw, ph)
	end
	inst.Size = slot and UDim2.fromScale(1, 1) or sizeUDim2(node.w, node.h, pw, ph)
	if node.rot then
		inst.Rotation = node.rot
	end

	local opacity = node.op or 1

	if isText then
		local t = node.txt
		inst.BackgroundTransparency = 1
		inst.Text = t.s
		inst.Font = pickFont(t.fam, t.sty)
		inst.TextWrapped = true
		inst.RichText = false
		inst.TextXAlignment = TEXT_X[t.ax] or Enum.TextXAlignment.Left
		inst.TextYAlignment = TEXT_Y[t.ay] or Enum.TextYAlignment.Top
		if t.fill and t.fill.k == "solid" then
			inst.TextColor3 = rgb(t.fill.c)
			inst.TextTransparency = transparency(t.fill.a, opacity)
		else
			inst.TextColor3 = Color3.new(1, 1, 1)
			inst.TextTransparency = transparency(1, opacity)
		end
		if mode == "pixels" then
			local designSize = math.clamp(math.floor(S(t.size) * textScale + 0.5), 1, 100)
			inst.TextSize = designSize
			-- fonts that draw smaller than the Figma font may grow (FONT_BOOST); the size is then fitted to the Figma box
			local boost = FONT_BOOST[inst.Font.Name] or 1.12
			local fitted, usedH = fitTextSize(t.s, inst.Font, designSize * boost, S(node.w), S(node.h), true, (utf8.len(t.s) or #t.s) > 24 and 2 or nil)
			if fitted then
				inst.TextSize = fitted
				designSize = fitted
				-- the text needed more lines than the Figma box is tall: the box grows downward so the extra lines are not cut off
				if usedH and usedH > S(node.h) + 1 then
					inst.TextWrapped = true
					inst.TextYAlignment = Enum.TextYAlignment.Top
					inst.AutomaticSize = Enum.AutomaticSize.Y
				end
			end
			-- Roblox fonts are often wider than the Figma font, and text that does not fit wraps and gets cut off.
			-- So the text is fitted to its box: it keeps the Figma size when it fits and only shrinks when it would not.
			-- (Letter-by-letter text effects need a fixed size, so those labels stay fixed.)
			local letterFx = false
			for _, tag in ipairs(node.tags or {}) do
				local tagName = parseTag(tag)
				if tagName and (tagName == "textwave" or tagName == "textshake" or tagName == "textpop" or tagName == "textrainbow" or tagName == "textglitch") then
					letterFx = true
				end
			end
			if not letterFx and not fitted then
				inst.TextScaled = true
				local fit = Instance.new("UITextSizeConstraint")
				fit.MaxTextSize = designSize
				fit.MinTextSize = 6
				fit.Parent = inst
			end
		else
			-- scales with the screen; the cap keeps it from growing past the design size by too much
			inst.TextScaled = true
			local c = Instance.new("UITextSizeConstraint")
			c.MaxTextSize = math.clamp(math.floor(t.size * 2 * textScale * (FONT_BOOST[inst.Font.Name] or 1)), 8, 100)
			c.MinTextSize = 1
			c.Parent = inst
		end
	else
		if fill and fill.k == "solid" then
			inst.BackgroundColor3 = rgb(fill.c)
			inst.BackgroundTransparency = transparency(fill.a, opacity)
		elseif fill and fill.k == "grad" then
			inst.BackgroundColor3 = Color3.new(1, 1, 1)
			inst.BackgroundTransparency = 0
			addGradient(inst, fill, opacity)
		else
			inst.BackgroundTransparency = 1
		end
		if isImage then
			local upId = node.img and currentImages[node.img]
			inst.Image = upId and ("rbxassetid://" .. resolveImageId(tostring(upId))) or ""
			inst.ImageTransparency = transparency(1, opacity)
			inst.ScaleType = Enum.ScaleType.Fit
			if fill and fill.k == "image" then
				inst.BackgroundTransparency = 1
			elseif node.t == "vector" then
				-- an icon's fill is the icon's colour, not a box behind it: keep it as a tint for the picture you add
				inst.BackgroundTransparency = 1
				if fill and fill.k == "solid" and not upId then
					inst.ImageColor3 = rgb(fill.c)
				end
			end
		end
		if node.clip then
			inst.ClipsDescendants = true
		end
	end

	-- rounded corners
	local radius = node.r
	if node.t == "ellipse" then
		local c = Instance.new("UICorner")
		c.CornerRadius = UDim.new(0.5, 0)
		c.Parent = inst
	elseif radius and radius > 0 then
		local c = Instance.new("UICorner")
		local shortSide = math.max(1, math.min(node.w, node.h))
		if mode == "pixels" then
			c.CornerRadius = UDim.new(0, S(math.min(radius, shortSide / 2)))
		else
			c.CornerRadius = UDim.new(math.min(0.5, radius / shortSide), 0)
		end
		c.Parent = inst
	end

	-- the tiled background gets the very same corner as the layer, so it can never stick out past a rounded edge
	if bgInfo and not isText then
		local pic = inst:FindFirstChild("Background")
		local ownCorner = inst:FindFirstChildOfClass("UICorner")
		if pic and ownCorner then
			local old = pic:FindFirstChildOfClass("UICorner")
			if old then
				old:Destroy()
			end
			ownCorner:Clone().Parent = pic
		end
	end

	-- border
	if node.stroke then
		local s = Instance.new("UIStroke")
		s.Thickness = (mode == "pixels") and math.max(1, S(node.stroke.w)) or node.stroke.w
		s.Color = rgb(node.stroke.c)
		s.Transparency = transparency(node.stroke.a, opacity)
		if isText then
			s.ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual
		else
			s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
		end
		s.Parent = inst
	end

	-- auto layout -> list layout + padding
	local lay = node.lay
	local hasAbs = false
	for _, c in ipairs(node.ch or {}) do
		if c.abs then
			hasAbs = true
		end
	end
	-- a list layout would push a background picture or an "absolute" layer around, so those stay outside it
	-- UIEffects adds its light, border and shine layers as extra children of the layer. Inside a list layout each of them would become a list item
	-- and push the real rows out of the panel, so a layer with effects keeps its list in an inner "Content" frame.
	local hasFx = false
	if runEffects and node.tags then
		for _, tag in ipairs(node.tags) do
			local tagName = parseTag(tag)
			if tagName and not BEHAVIOR[tagName] and not (bgInfo and tagName == "bg") then
				hasFx = true
			end
		end
	end
	local content = inst
	if lay and not isText and (bgInfo or hasAbs or hasFx) then
		content = Instance.new("Frame")
		content.Name = "Content"
		content.BackgroundTransparency = 1
		content.BorderSizePixel = 0
		content.Size = UDim2.fromScale(1, 1)
		content.Parent = inst
	end
	if bgInfo and not isText then
		-- a tiled picture ignores UICorner and shows as a square box, so it sits inside a CanvasGroup: that one clips its children to the rounded shape
		local pic = Instance.new("CanvasGroup")
		pic.Name = "Background"
		pic.BackgroundTransparency = 1
		pic.BorderSizePixel = 0
		pic.Size = UDim2.fromScale(1, 1)
		pic.Active = false
		pic.ZIndex = 0
		local tiles = Instance.new("ImageLabel")
		tiles.Name = "Tiles"
		tiles.BackgroundTransparency = 1
		tiles.BorderSizePixel = 0
		tiles.Size = UDim2.fromScale(1, 1)
		tiles.Image = "rbxassetid://" .. resolveImageId(bgInfo.id)
		tiles:SetAttribute("SourceAssetId", bgInfo.id)
		tiles.ScaleType = Enum.ScaleType.Tile
		tiles.TileSize = UDim2.fromOffset(S(bgInfo.tile), S(bgInfo.tile))
		tiles.ImageTransparency = 1 - bgInfo.opacity
		tiles.ZIndex = 0
		tiles.Parent = pic
		local pc = Instance.new("UICorner")
		if node.t == "ellipse" then
			pc.CornerRadius = UDim.new(0.5, 0)
		elseif node.r and node.r > 0 then
			local shortSide = math.max(1, math.min(node.w, node.h))
			if mode == "pixels" then
				pc.CornerRadius = UDim.new(0, S(math.min(node.r, shortSide / 2)))
			else
				pc.CornerRadius = UDim.new(math.min(0.5, node.r / shortSide), 0)
			end
		else
			pc = nil
		end
		if pc then
			pc.Parent = pic
		end
		pic.Parent = inst
	end
	if lay then
		local list = Instance.new("UIListLayout")
		list.SortOrder = Enum.SortOrder.LayoutOrder
		local horizontal = lay.dir == "row"
		list.FillDirection = horizontal and Enum.FillDirection.Horizontal or Enum.FillDirection.Vertical
		local axisSize = horizontal and node.w or node.h
		if mode == "pixels" then
			list.Padding = UDim.new(0, S(lay.gap))
		else
			list.Padding = UDim.new(lay.gap / math.max(1, axisSize), 0)
		end
		if lay.main == "SPACE_BETWEEN" then
			pcall(function() -- needs a recent Studio; older ones just skip it
				if horizontal then
					list.HorizontalFlex = Enum.UIFlexAlignment.SpaceBetween
				else
					list.VerticalFlex = Enum.UIFlexAlignment.SpaceBetween
				end
			end)
		end
		local mainH = H_ALIGN[lay.main]
		local mainV = V_ALIGN[lay.main]
		local crossH = H_ALIGN[lay.cross]
		local crossV = V_ALIGN[lay.cross]
		if horizontal then
			list.HorizontalAlignment = mainH or Enum.HorizontalAlignment.Left
			list.VerticalAlignment = crossV or Enum.VerticalAlignment.Top
		else
			list.VerticalAlignment = mainV or Enum.VerticalAlignment.Top
			list.HorizontalAlignment = crossH or Enum.HorizontalAlignment.Left
		end
		list.Parent = content

		local pad = lay.pad
		if pad[1] > 0 or pad[2] > 0 or pad[3] > 0 or pad[4] > 0 then
			local p = Instance.new("UIPadding")
			if mode == "pixels" then
				p.PaddingTop = UDim.new(0, S(pad[1]))
				p.PaddingRight = UDim.new(0, S(pad[2]))
				p.PaddingBottom = UDim.new(0, S(pad[3]))
				p.PaddingLeft = UDim.new(0, S(pad[4]))
			else
				p.PaddingTop = UDim.new(pad[1] / math.max(1, node.h), 0)
				p.PaddingRight = UDim.new(pad[2] / math.max(1, node.w), 0)
				p.PaddingBottom = UDim.new(pad[3] / math.max(1, node.h), 0)
				p.PaddingLeft = UDim.new(pad[4] / math.max(1, node.w), 0)
			end
			p.Parent = content
		end
	end

	if slot then
		inst.Parent = slot
		slot.Parent = parent
	else
		inst.Parent = parent
	end

	if node.ch then
		for i, child in ipairs(node.ch) do
			build(child, child.abs and inst or content, node.w, node.h, lay ~= nil, i)
		end
	end
	if textTags then
		local label = inst:FindFirstChildWhichIsA("TextLabel", true)
		if label then
			stats.fx = stats.fx + applyEffectAttributes(label, textTags, nil)
		end
	end
	if node.tags then
		applyUiTags(inst, node, isText, inAuto)
	end
	return inst
end

local function buildScreen(screen)
	local gui = Instance.new("ScreenGui")
	gui.Name = cleanName(screen.name, "FigmaGui")
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui:SetAttribute("FigmaImported", true)

	local root = screen.root
	root.n = "Root"
	root.x = screen.w / 2
	root.y = screen.h / 2
	if mode == "pixels" then
		root.w = screen.w
		root.h = screen.h
	end
	local frame = build(root, gui, screen.w, screen.h, false, 1)
	-- one number to resize the whole screen: change Scale on this UIScale in Properties
	local uiScale = Instance.new("UIScale")
	uiScale.Name = "Scale"
	uiScale.Scale = 1
	uiScale.Parent = frame
	if mode == "pixels" then
		frame.AnchorPoint = Vector2.new(0.5, 0.5)
		frame.Position = UDim2.fromScale(0.5, 0.5)
		frame.Size = UDim2.fromOffset(S(screen.w), S(screen.h))
	else
		frame.AnchorPoint = Vector2.new(0.5, 0.5)
		frame.Position = UDim2.fromScale(0.5, 0.5)
		frame.Size = UDim2.fromScale(1, 1)
	end
	return gui
end

local EFFECTS_LOCALSCRIPT = [[-- Plays the effects found on this ScreenGui's layers (attributes Fx / Fx_<name>).
-- Made by the Figma > Studio plugin. The layers themselves are real objects, this only adds the movement.
local mainOk, mainErr = pcall(function()
	local mainModule = script.Parent:FindFirstChild("UIEffects")
	if not mainModule then
		error("no UIEffects module next to this script")
	end
	require(mainModule).applyTree(script.Parent)
end)
if not mainOk then
	warn("[Effects] your UIEffects module failed, so the built-in fallbacks play instead: " .. tostring(mainErr))
end
-- effects your UIEffects module does not have (hover and click, particles, cartoony motion, light and bar effects)
local extraModule = script.Parent:FindFirstChild("UIEffectsExtra")
if extraModule then
	local ok, err = pcall(function()
		require(extraModule).applyTree(script.Parent, not mainOk)
	end)
	if not ok then
		warn("[Effects] UIEffectsExtra failed: " .. tostring(err))
	end
end
]]

local EXTRA_SOURCE = [==[-- UIEffectsExtra: every effect of the Figma plugin that the main UIEffects module does not have.
--   hover / click:  hoverpop hoverlift hovergrow hovertilt hovershine hoverglow hoverbright hoverwiggle press ripple clickburst print ref
--   particles:      embers snow fireflies coins hearts confetti bubbles rain leaves smoke shootingstar
--   cartoony:       jello rubberband tada wobble heartbeat headshake jelly jump wiggle flip  |  drop stamp unroll spinin rise shake
--   light:          torchlight lightning holo scanlines chase
--   bars:           barshine barstripes barpulse lowflash damage barfill barrainbow tipspark   (a bar = a frame with a child named "Fill")
-- Made by the Figma > Studio plugin. Reads the same attributes as UIEffects:  Fx = "coins|hovergrow"  and  Fx_coins = '{"count":8}'.
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local CollectionService = game:GetService("CollectionService")

local Extra = {}

local function hex(s, fallback)
	local ok, c = pcall(Color3.fromHex, tostring(s or ""))
	if ok then
		return c
	end
	return fallback or Color3.new(1, 1, 1)
end

local function num(p, key, def)
	local v = tonumber(p[key])
	if v == nil then
		return def
	end
	return v
end

local function frac(x)
	return x - math.floor(x)
end

local function params(inst, name)
	local raw = inst:GetAttribute("Fx_" .. name)
	if type(raw) == "string" and raw ~= "" then
		local ok, data = pcall(HttpService.JSONDecode, HttpService, raw)
		if ok and type(data) == "table" then
			return data
		end
	end
	return {}
end

local LAYOUTS = { "UIListLayout", "UIGridLayout", "UITableLayout", "UIPageLayout" }
local function isAuto(inst)
	local parent = inst.Parent
	if not parent then
		return false
	end
	for _, cls in ipairs(LAYOUTS) do
		if parent:FindFirstChildOfClass(cls) then
			return true
		end
	end
	return false
end

-- Roblox ClipsDescendants only ever clips to a RECTANGLE and ignores UICorner, so a plain Frame with a corner still lets
-- its children (the dark hover veil, shine streak, ripple...) show as a square box over a rounded button.
-- A CanvasGroup DOES clip to the UICorner shape, so rounded layers get a CanvasGroup overlay.
-- noClip = true gives a plain unclipped Frame for effects that must fly outside the layer (click burst, tip spark).
local function overlay(inst, name, noClip)
	local corner = inst:FindFirstChildOfClass("UICorner")
	local f
	if not noClip and corner then
		f = Instance.new("CanvasGroup")
	else
		f = Instance.new("Frame")
		f.ClipsDescendants = not noClip
	end
	f.Name = name
	f.BackgroundTransparency = 1
	f.BorderSizePixel = 0
	f.Size = UDim2.fromScale(1, 1)
	f.ZIndex = inst.ZIndex + 20
	f.Active = false
	f.Parent = inst
	if corner then
		corner:Clone().Parent = f
	end
	return f
end

local function round(f)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0.5, 0)
	c.Parent = f
end

local function mulUDim2(u, sx, sy)
	return UDim2.new(u.X.Scale * sx, u.X.Offset * sx, u.Y.Scale * sy, u.Y.Offset * sy)
end

local all = {}

----------------------------------------------------------------------
-- particles
----------------------------------------------------------------------
local LOOKS = {
	-- count, size, color, how it moves
	coins = { 8, 14, "#ffd23f", "down" },
	snow = { 16, 6, "#ffffff", "down" },
	confetti = { 14, 8, "#ff5d8f", "down" },
	rain = { 16, 8, "#8ec5ff", "rain" },
	leaves = { 8, 10, "#79c24a", "leaf" },
	embers = { 12, 5, "#ff8a3d", "up" },
	hearts = { 7, 16, "#ff5d8f", "up" },
	bubbles = { 8, 14, "#bfe9ff", "up" },
	smoke = { 6, 14, "#b8bcc8", "smoke" },
	fireflies = { 8, 6, "#d9ff5a", "drift" },
	shootingstar = { 3, 6, "#ffffff", "shoot" },
}
local CONFETTI = { "#ff5d8f", "#ffd23f", "#5bc8ff", "#7cf36b", "#c9a7ff" }

local function particles(kind)
	local look = LOOKS[kind]
	return function(inst, p, ctx)
		local count = math.clamp(math.floor(num(p, "count", look[1])), 2, 40)
		local size = math.clamp(num(p, "size", look[2]), 3, 50)
		local color = hex(p.color, hex(look[3]))
		local speed = math.max(0.3, num(p, "speed", 1))
		local mode = look[4]
		local imgId = string.gsub(tostring(p.imageid or ""), "%D", "")
		local layer = overlay(inst, "FxParticles_" .. kind)
		-- particles sit BEHIND the layer's own content (text, icons, children) but in front of its fill, so a coin never covers the label.
		-- Fx_<name> {"layer":"front"} puts them back on top.
		if string.lower(tostring(p.layer or "back")) ~= "front" then
			layer.ZIndex = -1
		end
		local items = {}
		for i = 1, count do
			local r1, r2, r3 = frac(i * 0.618 + 0.11), frac(i * 0.37 + 0.3), frac(i * 0.83 + 0.5)
			local d = size * (0.6 + r2 * 0.7)
			local g
			if imgId ~= "" then
				-- your own picture: it replaces the little drawn shape
				g = Instance.new("ImageLabel")
				g.BackgroundTransparency = 1
				g.BorderSizePixel = 0
				g.Image = "rbxassetid://" .. imgId
				g.ScaleType = Enum.ScaleType.Fit
			elseif kind == "hearts" then
				g = Instance.new("TextLabel")
				g.BackgroundTransparency = 1
				g.Text = "❤"
				g.TextColor3 = color
				g.TextScaled = true
				g.Font = Enum.Font.GothamBold
			else
				g = Instance.new("Frame")
				g.BorderSizePixel = 0
				g.BackgroundColor3 = kind == "confetti" and hex(CONFETTI[(i % #CONFETTI) + 1]) or color
				if kind == "coins" then
					round(g)
					local edge = Instance.new("UIStroke")
					edge.Color = Color3.fromRGB(122, 82, 0)
					edge.Thickness = math.max(1, d * 0.14)
					edge.Parent = g
				elseif kind == "bubbles" then
					round(g)
					g.BackgroundTransparency = 0.8
					local edge = Instance.new("UIStroke")
					edge.Color = Color3.new(1, 1, 1)
					edge.Thickness = 1.5
					edge.Transparency = 0.3
					edge.Parent = g
				elseif kind == "embers" or kind == "fireflies" then
					round(g)
					local glow = Instance.new("UIStroke")
					glow.Color = color
					glow.Thickness = d * 0.5
					glow.Transparency = 0.8
					glow.Parent = g
				elseif kind == "snow" or kind == "smoke" then
					round(g)
				elseif kind == "shootingstar" then
					local grad = Instance.new("UIGradient")
					grad.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(1, 0) })
					grad.Parent = g
				end
			end
			g.AnchorPoint = Vector2.new(0.5, 0.5)
			g.Size = UDim2.fromOffset(d, d)
			g.Active = false
			g.Visible = false
			g.Parent = layer
			items[i] = { gui = g, r1 = r1, r2 = r2, r3 = r3, d = d, dur = (2.6 + r3 * 2.2) / speed, sway = (r2 - 0.5) * 44 }
		end

		ctx.loop(function(t)
			local w, h = layer.AbsoluteSize.X, layer.AbsoluteSize.Y
			if w < 2 or h < 2 then
				return
			end
			for _, it in ipairs(items) do
				local k = ((t + it.r3 * it.dur) / it.dur) % 1
				local x = it.d / 2 + it.r1 * math.max(1, w - it.d)
				local y, alpha = 0, 1
				local g = it.gui
				local visible = true
				if mode == "down" then
					y = -it.d + k * (h + it.d * 2)
					x += math.sin(k * 6.28 + it.r1 * 6) * it.sway * 0.5
					alpha = math.min(k / 0.08, 1) * math.min((1 - k) / 0.1, 1)
				elseif mode == "rain" then
					k = (k * 2.2) % 1
					y = -it.d * 2 + k * (h + it.d * 4)
					alpha = 0.75 * math.min(k / 0.05, 1) * math.min((1 - k) / 0.1, 1)
					g.Size = UDim2.fromOffset(math.max(1.5, it.d * 0.22), it.d * 2.2)
					g.Rotation = 8
				elseif mode == "leaf" then
					y = -it.d + k * (h + it.d * 2)
					x += math.sin(k * 12.5 + it.r1 * 6) * (it.sway + 14)
					alpha = math.min(k / 0.08, 1) * math.min((1 - k) / 0.1, 1)
					g.Rotation = k * 540 * (it.r1 > 0.5 and 1 or -1)
					g.Size = UDim2.fromOffset(it.d, it.d * 0.55)
				elseif mode == "up" then
					y = h - it.d - k * (h * 0.9 + 20)
					x += math.sin(k * 6.28 + it.r1 * 6) * it.sway * 0.5
					alpha = math.min(k / 0.2, 1) * (1 - k)
				elseif mode == "smoke" then
					y = h - it.d - k * (h * 0.8 + 10)
					x += math.sin(k * 5 + it.r1 * 6) * it.sway * 0.4
					local grow = it.d * (0.6 + k * 1.6)
					g.Size = UDim2.fromOffset(grow, grow)
					alpha = 0.45 * math.min(k / 0.15, 1) * (1 - k)
				elseif mode == "drift" then
					x += math.sin(k * 6.28) * it.sway
					y = it.r2 * math.max(1, h - it.d) - math.sin(k * 6.28) * it.sway * 0.6
					alpha = 0.15 + 0.85 * ((math.sin(k * 12.56 + it.r1 * 6) + 1) / 2)
				elseif mode == "shoot" then
					-- a streak crosses the layer, then a long pause
					local cycle = (t * speed * 0.4 + it.r3 * 3) % 4
					if cycle > 0.8 then
						visible = false
					else
						local q = cycle / 0.8
						x = w * (0.1 + it.r1 * 0.5) + q * w * 0.45
						y = h * (0.05 + it.r2 * 0.3) + q * h * 0.45
						g.Rotation = 40
						g.Size = UDim2.fromOffset(it.d * 5, math.max(1.5, it.d * 0.4))
						alpha = math.sin(q * math.pi)
					end
				end
				g.Visible = visible
				g.Position = UDim2.fromOffset(x, y)
				if kind == "coins" then
					-- a spinning coin: its width opens and closes
					g.Size = UDim2.fromOffset(math.max(1, it.d * math.abs(math.cos(k * 12.56 + it.r1 * 6))), it.d)
				elseif kind == "confetti" then
					g.Rotation = k * 720 * (it.r1 > 0.5 and 1 or -1)
					g.Size = UDim2.fromOffset(it.d, it.d * 0.5)
				end
				if g:IsA("ImageLabel") and (mode == "rain" or mode == "leaf" or mode == "shoot" or kind == "confetti") then
					g.Size = UDim2.fromOffset(it.d, it.d) -- a picture keeps its own shape instead of being squashed like the drawn piece
				end
				if g:IsA("ImageLabel") then
					g.ImageTransparency = 1 - alpha
				elseif g:IsA("TextLabel") then
					g.TextTransparency = 1 - alpha
				elseif kind == "bubbles" then
					g.BackgroundTransparency = 0.8 + (1 - alpha) * 0.2
				else
					g.BackgroundTransparency = 1 - alpha
				end
			end
		end)
		ctx.cleanup(function()
			layer:Destroy()
		end)
	end
end

for kind in pairs(LOOKS) do
	all[kind] = particles(kind)
	-- "pic<kind>" = the same particle but with your own picture. It has its own name so that your main UIEffects module,
	-- which draws its own little shape and ignores the picture, does not also play it and drown your picture out.
	all["pic" .. kind] = all[kind]
end

----------------------------------------------------------------------
-- cartoony motion, built on the "pose" (rotation, scale, squash, offset) each layer shares between effects
----------------------------------------------------------------------
local function cycle(t, dur, rest)
	local total = dur + rest
	local m = t % total
	if m < dur then
		return m / dur
	end
	return nil
end

local function beat(k, center, width)
	local x = (k - center) / width
	return math.exp(-x * x)
end

local function easeOutBack(k)
	local c1, c3 = 1.70158, 2.70158
	return 1 + c3 * (k - 1) ^ 3 + c1 * (k - 1) ^ 2
end

local function easeOutBounce(k)
	if k < 1 / 2.75 then
		return 7.5625 * k * k
	elseif k < 2 / 2.75 then
		k -= 1.5 / 2.75
		return 7.5625 * k * k + 0.75
	elseif k < 2.5 / 2.75 then
		k -= 2.25 / 2.75
		return 7.5625 * k * k + 0.9375
	end
	k -= 2.625 / 2.75
	return 7.5625 * k * k + 0.984375
end

-- looping motion: fn(k, A, p) -> rotation, scale, offsetX, offsetY, squashX, squashY
local function motion(name, dur, defaultRest, fn)
	all[name] = function(inst, p, ctx)
		local speed = math.max(0.3, num(p, "speed", 1))
		local A = num(p, "amount", 1)
		local rest = num(p, "rest", defaultRest)
		local pose = ctx.pose()
		ctx.loop(function(t)
			local k = cycle(t * speed, dur, rest * speed)
			if not k then
				pose.rot, pose.scale, pose.dx, pose.dy, pose.sx, pose.sy = 0, 1, 0, 0, 1, 1
				return
			end
			local r, s, x, y, qx, qy = fn(k, A, p)
			pose.rot, pose.scale, pose.dx, pose.dy, pose.sx, pose.sy = r or 0, s or 1, x or 0, y or 0, qx or 1, qy or 1
		end)
	end
end

motion("jello", 0.9, 1.2, function(k, A)
	local decay = 1 - k
	return A * 9 * math.sin(k * 18.85) * decay, 1, 0, 0, 1 + A * 0.07 * math.sin(k * 18.85 + 1.57) * decay, 1 - A * 0.07 * math.sin(k * 18.85 + 1.57) * decay
end)
motion("rubberband", 1.0, 1, function(k, A)
	local w = math.sin(k * 12.57) * (1 - k)
	return 0, 1 + 0.05 * A * w, 0, 0, 1 + 0.25 * A * w, 1 - 0.2 * A * w
end)
motion("tada", 1.1, 1.5, function(k, A)
	local lift = math.sin(k * math.pi)
	return 3 * A * math.sin(k * 31.4) * lift, 1 + 0.1 * A * lift - (k < 0.1 and 0.1 * A * (1 - k / 0.1) or 0)
end)
motion("wobble", 1.1, 1.2, function(k, A)
	return A * 8 * math.sin(k * 12.57) * (1 - k), 1, A * 5 * math.sin(k * 12.57) * (1 - k)
end)
motion("heartbeat", 0.9, 0.6, function(k, A)
	return 0, 1 + A * (0.18 * beat(k, 0.15, 0.06) + 0.12 * beat(k, 0.35, 0.06))
end)
motion("headshake", 0.6, 1.5, function(k, A)
	local w = math.sin(k * 18.85) * (1 - k)
	return A * 3 * w, 1, A * 8 * w
end)
motion("wiggle", 0.8, 1.5, function(k, A)
	return A * 12 * math.sin(k * 31.4) * (1 - k)
end)
motion("jump", 0.9, 1.2, function(k, A, p)
	local height = num(p, "height", 24)
	local squash = num(p, "squash", 0.5)
	local dy, sy, sx = 0, 1, 1
	if k < 0.2 then
		local c = k / 0.2
		sy, sx = 1 - 0.12 * squash * c, 1 + 0.1 * squash * c
	elseif k < 0.7 then
		local a = (k - 0.2) / 0.5
		dy = -height * math.sin(a * math.pi)
		sy, sx = 1 + 0.12 * squash, 1 - 0.08 * squash
	else
		local c = (k - 0.7) / 0.3
		sy, sx = 1 - 0.14 * squash * (1 - c), 1 + 0.1 * squash * (1 - c)
	end
	return 0, 1, 0, dy, sx, sy
end)
motion("flip", 1.0, 2, function(k, A, p)
	local c = math.abs(math.cos(k * math.pi * 2))
	if string.lower(tostring(p.axis or "y")) == "x" then
		return 0, 1, 0, 0, 1, math.max(0.02, c)
	end
	return 0, 1, 0, 0, math.max(0.02, c), 1
end)

-- continuous motion
all.jelly = function(inst, p, ctx)
	local speed = math.max(0.3, num(p, "speed", 1))
	local A = num(p, "amount", 1)
	local pose = ctx.pose()
	ctx.loop(function(t)
		local s = math.sin(t * speed * 5)
		pose.rot = 2 * A * math.sin(t * speed * 5 + 1)
		pose.scale = 1 + 0.02 * A * s
		pose.sx = 1 + 0.06 * A * s
		pose.sy = 1 - 0.06 * A * s
	end)
end

all.shake = function(inst, p, ctx)
	local speed = math.max(0.3, num(p, "speed", 1))
	local amount = num(p, "amount", 2)
	local pose = ctx.pose()
	ctx.loop(function(t)
		pose.dx = math.noise(t * speed * 20, 1.3) * amount * 2
		pose.dy = math.noise(t * speed * 20, 7.7) * amount * 2
		pose.rot = math.noise(t * speed * 20, 4.1) * amount * 0.6
	end)
end

-- entrance motion: plays once when the screen starts. fn(k, p) -> rotation, scale, offsetX, offsetY, squashX, squashY, fade
local function entrance(name, dur, fn)
	all[name] = function(inst, p, ctx)
		local speed = math.max(0.3, num(p, "speed", 1))
		local pose = ctx.pose()
		local fadeList = {}
		local function addFade(o)
			if o:IsA("GuiObject") then
				table.insert(fadeList, { o, "BackgroundTransparency", o.BackgroundTransparency })
				if o:IsA("TextLabel") or o:IsA("TextButton") then
					table.insert(fadeList, { o, "TextTransparency", o.TextTransparency })
				end
				if o:IsA("ImageLabel") or o:IsA("ImageButton") then
					table.insert(fadeList, { o, "ImageTransparency", o.ImageTransparency })
				end
			end
		end
		addFade(inst)
		for _, d in ipairs(inst:GetDescendants()) do
			addFade(d)
		end
		local started = nil
		local baseAbs = nil
		ctx.loop(function(t)
			started = started or t
			baseAbs = baseAbs or inst.AbsoluteSize
			local k = math.clamp((t - started) * speed / dur, 0, 1)
			local r, s, x, y, qx, qy, fade = fn(k, p, baseAbs)
			pose.rot, pose.scale, pose.dx, pose.dy, pose.sx, pose.sy = r or 0, s or 1, x or 0, y or 0, qx or 1, qy or 1
			if fade ~= nil then
				for _, f in ipairs(fadeList) do
					if f[1].Parent then
						f[1][f[2]] = f[3] + (1 - f[3]) * (1 - fade)
					end
				end
			end
		end)
		ctx.cleanup(function()
			for _, f in ipairs(fadeList) do
				if f[1].Parent then
					f[1][f[2]] = f[3]
				end
			end
		end)
	end
end

entrance("drop", 0.9, function(k, p)
	local distance = num(p, "distance", 80)
	local e = easeOutBounce(k)
	local squash = (k > 0.5 and k < 0.7) and math.sin((k - 0.5) / 0.2 * math.pi) * 0.15 or 0
	return 0, 0.7 + 0.3 * math.min(1, k * 3), 0, -distance * (1 - e), 1 + squash, 1 - squash, math.min(1, k * 4)
end)
entrance("stamp", 0.45, function(k, p)
	local A = num(p, "amount", 1)
	local e = easeOutBack(k)
	return 0, 1 + 1.2 * A * (1 - e), 0, 0, 1, 1, math.min(1, k * 4)
end)
entrance("spinin", 0.7, function(k)
	local e = easeOutBack(k)
	return -180 * (1 - e), math.max(0.001, e), 0, 0, 1, 1, math.min(1, k * 3)
end)
entrance("rise", 0.7, function(k, p)
	local distance = num(p, "distance", 24)
	local e = 1 - (1 - k) ^ 3
	return 0, 1, 0, distance * (1 - e), 1, 1, e
end)
entrance("unroll", 0.8, function(k, p, baseAbs)
	local e = 1 - (1 - k) ^ 3
	-- opens from the top: shrinks toward the top edge while closed
	local dy = -(baseAbs.Y * (1 - e)) / 2
	return 0, 1, 0, dy, 1, math.max(0.02, e), math.min(1, k * 3)
end)

----------------------------------------------------------------------
-- hover / press / click
----------------------------------------------------------------------
-- h goes smoothly between 0 (mouse away) and 1 (mouse over); down is true while the button is held
local function hoverState(inst, ctx)
	local st = { h = 0, target = 0, down = false, enterAt = -10, clock = 0 }
	local a = inst.MouseEnter:Connect(function()
		st.target = 1
		st.enterAt = st.clock
	end)
	local b = inst.MouseLeave:Connect(function()
		st.target = 0
		st.down = false
	end)
	local c = inst.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			st.down = true
		end
	end)
	local d = inst.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			st.down = false
		end
	end)
	ctx.cleanup(function()
		a:Disconnect()
		b:Disconnect()
		c:Disconnect()
		d:Disconnect()
	end)
	ctx.loop(function(t, dt)
		st.clock = t
		st.h += (st.target - st.h) * math.clamp((dt or 0.016) * 14, 0, 1)
	end)
	return st
end

all.hovergrow = function(inst, p, ctx)
	local amount = math.max(1.01, num(p, "scale", 1.1))
	local st = hoverState(inst, ctx)
	local pose = ctx.pose()
	ctx.loop(function()
		pose.scale = 1 + (amount - 1) * st.h
	end)
end

all.hoverlift = function(inst, p, ctx)
	local distance = num(p, "distance", 6)
	local st = hoverState(inst, ctx)
	local pose = ctx.pose()
	local auto = isAuto(inst)
	ctx.loop(function()
		pose.dy = -distance * st.h
		if auto then
			pose.scale = 1 + 0.04 * st.h -- a list layout keeps the layer in place, so it grows a little instead
		end
	end)
end

all.hovertilt = function(inst, p, ctx)
	local angle = num(p, "angle", 8)
	local st = hoverState(inst, ctx)
	local pose = ctx.pose()
	ctx.loop(function()
		local mouse = UserInputService:GetMouseLocation()
		local center = inst.AbsolutePosition.X + inst.AbsoluteSize.X / 2
		local side = math.clamp((mouse.X - center) / math.max(1, inst.AbsoluteSize.X / 2), -1, 1)
		pose.rot = angle * side * st.h
	end)
end

all.hoverwiggle = function(inst, p, ctx)
	local A = num(p, "amount", 1)
	local st = hoverState(inst, ctx)
	local pose = ctx.pose()
	ctx.loop(function(t)
		local age = st.clock - st.enterAt
		pose.rot = (age >= 0 and age < 0.5) and A * 8 * math.sin(age * 40) * (1 - age / 0.5) or 0
	end)
end

all.press = function(inst, p, ctx)
	local depth = num(p, "depth", 3)
	local amount = math.clamp(num(p, "scale", 0.95), 0.5, 1)
	local st = hoverState(inst, ctx)
	local pose = ctx.pose()
	local k = 0
	ctx.loop(function(_, dt)
		k += ((st.down and 1 or 0) - k) * math.clamp((dt or 0.016) * 22, 0, 1)
		pose.scale = 1 - (1 - amount) * k
		pose.dy = depth * k
	end)
end

all.hoverbright = function(inst, p, ctx)
	local amount = math.clamp(num(p, "amount", 1.25), 1.02, 2)
	local st = hoverState(inst, ctx)
	local layer = overlay(inst, "FxHoverBright")
	local veil = Instance.new("Frame")
	veil.BackgroundColor3 = Color3.new(1, 1, 1)
	veil.BorderSizePixel = 0
	veil.Size = UDim2.fromScale(1, 1)
	veil.BackgroundTransparency = 1
	veil.Active = false
	veil.Parent = layer
	ctx.loop(function()
		veil.BackgroundTransparency = 1 - (amount - 1) * 0.5 * st.h
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.hoverglow = function(inst, p, ctx)
	local color = hex(p.color, Color3.fromRGB(255, 213, 74))
	local size = num(p, "size", 1)
	local st = hoverState(inst, ctx)
	local stroke = Instance.new("UIStroke")
	stroke.Name = "FxHoverGlow"
	stroke.Color = color
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Thickness = 0.1
	stroke.Transparency = 1
	stroke.Parent = inst
	ctx.loop(function()
		stroke.Thickness = math.max(0.1, 7 * size * st.h)
		stroke.Transparency = 1 - 0.8 * st.h
	end)
	ctx.cleanup(function()
		stroke:Destroy()
	end)
end

all.hovershine = function(inst, p, ctx)
	local color = hex(p.color, Color3.new(1, 1, 1))
	local speed = math.max(0.3, num(p, "speed", 1))
	local st = hoverState(inst, ctx)
	local layer = overlay(inst, "FxHoverShine")
	local streak = Instance.new("Frame")
	streak.BackgroundColor3 = color
	streak.BackgroundTransparency = 0.4
	streak.BorderSizePixel = 0
	streak.AnchorPoint = Vector2.new(0.5, 0.5)
	streak.Size = UDim2.fromScale(0.25, 2.4)
	streak.Rotation = 20
	streak.Visible = false
	streak.Parent = layer
	local grad = Instance.new("UIGradient")
	grad.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.5, 0), NumberSequenceKeypoint.new(1, 1) })
	grad.Parent = streak
	ctx.loop(function()
		local k = (st.clock - st.enterAt) * speed / 0.6
		if k >= 0 and k <= 1 then
			streak.Visible = true
			streak.Position = UDim2.fromScale(-0.2 + 1.4 * k, 0.5)
		else
			streak.Visible = false
		end
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.hoverpop = function(inst, p, ctx)
	local color = hex(p.color, Color3.fromRGB(255, 154, 31))
	local thick = math.max(1, num(p, "thickness", 3))
	local scale = math.max(1, num(p, "scale", 1.06))
	local tilt = num(p, "tilt", 0) -- no tilt unless asked: a tilting, growing hover looked wrong on pills and buttons
	local dim = math.clamp(num(p, "dim", 0.35), 0, 0.8)
	local st = hoverState(inst, ctx)
	local pose = ctx.pose()
	local stroke = Instance.new("UIStroke")
	stroke.Name = "FxHoverPop"
	stroke.Color = color
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Thickness = thick
	stroke.Transparency = 1
	stroke.Parent = inst
	local layer = overlay(inst, "FxHoverPopDim")
	local veil = Instance.new("Frame")
	veil.BackgroundColor3 = Color3.new(0, 0, 0)
	veil.BorderSizePixel = 0
	veil.Size = UDim2.fromScale(1, 1)
	veil.BackgroundTransparency = 1
	veil.Active = false
	veil.Parent = layer
	ctx.loop(function()
		stroke.Transparency = 1 - st.h
		veil.BackgroundTransparency = 1 - dim * st.h
		pose.scale = 1 + (scale - 1) * st.h
		pose.rot = tilt * st.h
	end)
	ctx.cleanup(function()
		stroke:Destroy()
		layer:Destroy()
	end)
end

local function clickPoint(inst, input)
	local pos = input.Position
	return Vector2.new(pos.X - inst.AbsolutePosition.X, pos.Y - inst.AbsolutePosition.Y)
end

local function isClick(input)
	return input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch
end

all.ripple = function(inst, p, ctx)
	local color = hex(p.color, Color3.new(1, 1, 1))
	local speed = math.max(0.3, num(p, "speed", 1))
	local layer = overlay(inst, "FxRipple")
	local conn = inst.InputBegan:Connect(function(input)
		if not isClick(input) then
			return
		end
		local at = clickPoint(inst, input)
		local ring = Instance.new("Frame")
		ring.BackgroundColor3 = color
		ring.BackgroundTransparency = 0.6
		ring.BorderSizePixel = 0
		ring.AnchorPoint = Vector2.new(0.5, 0.5)
		ring.Position = UDim2.fromOffset(at.X, at.Y)
		ring.Size = UDim2.fromOffset(4, 4)
		ring.Active = false
		round(ring)
		ring.Parent = layer
		local big = math.max(inst.AbsoluteSize.X, inst.AbsoluteSize.Y) * 2.2
		local tween = TweenService:Create(ring, TweenInfo.new(0.6 / speed, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Size = UDim2.fromOffset(big, big), BackgroundTransparency = 1 })
		tween:Play()
		tween.Completed:Once(function()
			ring:Destroy()
		end)
	end)
	ctx.cleanup(function()
		conn:Disconnect()
		layer:Destroy()
	end)
end

all.clickburst = function(inst, p, ctx)
	local count = math.clamp(math.floor(num(p, "count", 10)), 3, 30)
	local size = math.max(2, num(p, "size", 6))
	local color = hex(p.color, Color3.fromRGB(255, 213, 74))
	local layer = overlay(inst, "FxClickBurst", true)
	local conn = inst.InputBegan:Connect(function(input)
		if not isClick(input) then
			return
		end
		local at = clickPoint(inst, input)
		for i = 1, count do
			local a = (i / count) * math.pi * 2 + frac(i * 0.37) * 0.6
			local far = 24 + frac(i * 0.61) * 34
			local bit = Instance.new("Frame")
			bit.BackgroundColor3 = color
			bit.BorderSizePixel = 0
			bit.AnchorPoint = Vector2.new(0.5, 0.5)
			bit.Position = UDim2.fromOffset(at.X, at.Y)
			bit.Size = UDim2.fromOffset(size, size)
			bit.Rotation = frac(i * 0.77) * 90
			bit.Active = false
			bit.Parent = layer
			local tween = TweenService:Create(bit, TweenInfo.new(0.5, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
				Position = UDim2.fromOffset(at.X + math.cos(a) * far, at.Y + math.sin(a) * far),
				BackgroundTransparency = 1,
				Rotation = bit.Rotation + 180,
			})
			tween:Play()
			tween.Completed:Once(function()
				bit:Destroy()
			end)
		end
	end)
	ctx.cleanup(function()
		conn:Disconnect()
		layer:Destroy()
	end)
end

all.print = function(inst, p, ctx)
	local text = tostring(p.text or "Button clicked!")
	local when = string.lower(tostring(p.when or "click"))
	local function say()
		local ref = inst:GetAttribute("Ref")
		print((ref and ("[" .. tostring(ref) .. "] ") or "") .. text)
	end
	local conns = {}
	if when == "hover" then
		table.insert(conns, inst.MouseEnter:Connect(say))
	else
		table.insert(conns, inst.InputBegan:Connect(function(input)
			if isClick(input) then
				say()
			end
		end))
	end
	ctx.cleanup(function()
		for _, c in ipairs(conns) do
			c:Disconnect()
		end
	end)
end

all.ref = function(inst, p)
	local name = tostring(p.name or "")
	if name ~= "" then
		inst:SetAttribute("Ref", name)
		CollectionService:AddTag(inst, name)
	end
end

----------------------------------------------------------------------
-- light effects
----------------------------------------------------------------------
all.torchlight = function(inst, p, ctx)
	local color = hex(p.color, Color3.fromRGB(255, 154, 61))
	local size = num(p, "size", 1)
	local speed = math.max(0.3, num(p, "speed", 1))
	local stroke = Instance.new("UIStroke")
	stroke.Name = "FxTorchlight"
	stroke.Color = color
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Parent = inst
	ctx.loop(function(t)
		local n = math.noise(t * speed * 7, 2.2) + 0.5 * math.noise(t * speed * 17, 5.5)
		stroke.Thickness = math.max(1, 7 * size * (1 + n * 0.45))
		stroke.Transparency = math.clamp(0.55 - n * 0.3, 0.2, 0.85)
	end)
	ctx.cleanup(function()
		stroke:Destroy()
	end)
end

all.lightning = function(inst, p, ctx)
	local color = hex(p.color, Color3.fromRGB(159, 232, 255))
	local speed = math.max(0.3, num(p, "speed", 1))
	local stroke = Instance.new("UIStroke")
	stroke.Name = "FxLightning"
	stroke.Color = color
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Parent = inst
	ctx.loop(function(t)
		local n = math.noise(t * speed * 9, 8.8)
		local flash = math.clamp((n - 0.12) * 5, 0, 1)
		stroke.Thickness = 1 + 4 * flash
		stroke.Transparency = 1 - flash
	end)
	ctx.cleanup(function()
		stroke:Destroy()
	end)
end

all.holo = function(inst, p, ctx)
	local speed = math.max(0.3, num(p, "speed", 1))
	local layer = overlay(inst, "FxHolo")
	local sheen = Instance.new("Frame")
	sheen.BackgroundColor3 = Color3.new(1, 1, 1)
	sheen.BorderSizePixel = 0
	sheen.Size = UDim2.fromScale(1, 1)
	sheen.Active = false
	sheen.Parent = layer
	local grad = Instance.new("UIGradient")
	grad.Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 120, 200)),
		ColorSequenceKeypoint.new(0.25, Color3.fromRGB(255, 230, 120)),
		ColorSequenceKeypoint.new(0.5, Color3.fromRGB(120, 255, 200)),
		ColorSequenceKeypoint.new(0.75, Color3.fromRGB(120, 180, 255)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 120, 200)),
	})
	grad.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.5, 0.65), NumberSequenceKeypoint.new(1, 1) })
	grad.Rotation = 30
	grad.Parent = sheen
	ctx.loop(function(t)
		grad.Offset = Vector2.new(((t * speed * 0.35) % 2) - 1, 0)
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.scanlines = function(inst, p, ctx)
	local strength = math.clamp(num(p, "opacity", 0.3), 0.05, 0.8)
	local speed = math.max(0.3, num(p, "speed", 1))
	local layer = overlay(inst, "FxScanlines")
	local h = math.max(8, inst.AbsoluteSize.Y)
	for y = 0, math.min(150, math.floor(h / 4)) do
		local line = Instance.new("Frame")
		line.BackgroundColor3 = Color3.new(0, 0, 0)
		line.BackgroundTransparency = 1 - strength * 0.6
		line.BorderSizePixel = 0
		line.Position = UDim2.fromOffset(0, y * 4)
		line.Size = UDim2.new(1, 0, 0, 1)
		line.Active = false
		line.Parent = layer
	end
	local band = Instance.new("Frame")
	band.BackgroundColor3 = Color3.new(1, 1, 1)
	band.BorderSizePixel = 0
	band.Size = UDim2.new(1, 0, 0.25, 0)
	band.Active = false
	band.Parent = layer
	local grad = Instance.new("UIGradient")
	grad.Rotation = 90
	grad.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.5, 0.85), NumberSequenceKeypoint.new(1, 1) })
	grad.Parent = band
	ctx.loop(function(t)
		band.Position = UDim2.fromScale(0, -0.25 + ((t * speed * 0.3) % 1.25))
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.chase = function(inst, p, ctx)
	local color = hex(p.color, Color3.fromRGB(77, 243, 255))
	local width = math.max(1, num(p, "size", 3))
	local speed = math.max(0.3, num(p, "speed", 1))
	local stroke = Instance.new("UIStroke")
	stroke.Name = "FxChase"
	stroke.Color = color
	stroke.Thickness = width
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Parent = inst
	local grad = Instance.new("UIGradient")
	grad.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 1),
		NumberSequenceKeypoint.new(0.4, 1),
		NumberSequenceKeypoint.new(0.5, 0),
		NumberSequenceKeypoint.new(0.6, 1),
		NumberSequenceKeypoint.new(1, 1),
	})
	grad.Parent = stroke
	ctx.loop(function(t)
		grad.Rotation = (t * 120 * speed) % 360
	end)
	ctx.cleanup(function()
		stroke:Destroy()
	end)
end

----------------------------------------------------------------------
-- bars (health, mana, XP): the bar is a frame; its fill is the child named "Fill" (or its biggest child)
----------------------------------------------------------------------
local function findFill(bar)
	local best, bestArea = nil, -1
	for _, c in ipairs(bar:GetChildren()) do
		if c:IsA("GuiObject") and not string.find(string.lower(c.Name), "shine") and string.sub(c.Name, 1, 2) ~= "Fx" then
			if string.lower(c.Name) == "fill" then
				return c
			end
			local area = c.AbsoluteSize.X * c.AbsoluteSize.Y
			if area > bestArea then
				best, bestArea = c, area
			end
		end
	end
	return best
end

-- sets how full the fill is (0..1), keeping its left edge in place
local function fillTo(fill, home, k)
	local size, pos = home.size, home.pos
	local left = UDim2.new(pos.X.Scale - size.X.Scale * fill.AnchorPoint.X, pos.X.Offset - size.X.Offset * fill.AnchorPoint.X, 0, 0)
	local newSize = UDim2.new(size.X.Scale * k, size.X.Offset * k, size.Y.Scale, size.Y.Offset)
	fill.Size = newSize
	fill.Position = UDim2.new(left.X.Scale + newSize.X.Scale * fill.AnchorPoint.X, left.X.Offset + newSize.X.Offset * fill.AnchorPoint.X, pos.Y.Scale, pos.Y.Offset)
end

local function barBase(inst, ctx)
	local fill = findFill(inst)
	local home = fill and { size = fill.Size, pos = fill.Position } or nil
	if fill then
		ctx.cleanup(function()
			if fill.Parent then
				fill.Size, fill.Position = home.size, home.pos
			end
		end)
	end
	return fill, home
end

all.barfill = function(inst, p, ctx)
	local speed = math.max(0.3, num(p, "speed", 1))
	local fill, home = barBase(inst, ctx)
	if not fill then
		return
	end
	ctx.loop(function(t)
		local k = ((t * speed) % 3) / 3
		fillTo(fill, home, math.clamp(k / 0.6, 0, 1))
	end)
end

all.barshine = function(inst, p, ctx)
	local speed = math.max(0.3, num(p, "speed", 1))
	local layer = overlay(inst, "FxBarShine")
	local streak = Instance.new("Frame")
	streak.BackgroundColor3 = Color3.new(1, 1, 1)
	streak.BorderSizePixel = 0
	streak.AnchorPoint = Vector2.new(0.5, 0.5)
	streak.Size = UDim2.fromScale(0.2, 2.4)
	streak.Rotation = 20
	streak.Parent = layer
	local grad = Instance.new("UIGradient")
	grad.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.5, 0.35), NumberSequenceKeypoint.new(1, 1) })
	grad.Parent = streak
	ctx.loop(function(t)
		streak.Position = UDim2.fromScale(-0.2 + 1.4 * (((t * speed) % 2.2) / 2.2), 0.5)
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.barstripes = function(inst, p, ctx)
	local strength = math.clamp(num(p, "strength", 0.25), 0.05, 0.7)
	local speed = math.max(0.3, num(p, "speed", 1))
	local layer = overlay(inst, "FxBarStripes")
	local stripes = Instance.new("Frame")
	stripes.BackgroundColor3 = Color3.new(1, 1, 1)
	stripes.BorderSizePixel = 0
	stripes.Size = UDim2.fromScale(1, 1)
	stripes.Active = false
	stripes.Parent = layer
	local keys = {}
	for i = 0, 12 do
		table.insert(keys, NumberSequenceKeypoint.new(i / 12, (i % 2 == 0) and (1 - strength) or 1))
	end
	local grad = Instance.new("UIGradient")
	grad.Transparency = NumberSequence.new(keys)
	grad.Rotation = 45
	grad.Parent = stripes
	ctx.loop(function(t)
		grad.Offset = Vector2.new(((t * speed * 0.2) % 1) - 0.5, 0)
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.barpulse = function(inst, p, ctx)
	local speed = math.max(0.3, num(p, "speed", 1))
	local layer = overlay(inst, "FxBarPulse")
	local glow = Instance.new("Frame")
	glow.BackgroundColor3 = Color3.new(1, 1, 1)
	glow.BorderSizePixel = 0
	glow.Size = UDim2.fromScale(1, 1)
	glow.Active = false
	glow.Parent = layer
	ctx.loop(function(t)
		glow.BackgroundTransparency = 0.9 - 0.18 * ((math.sin(t * speed * 2.4) + 1) / 2)
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.lowflash = function(inst, p, ctx)
	local color = hex(p.color, Color3.fromRGB(255, 59, 59))
	local speed = math.max(0.3, num(p, "speed", 1))
	local layer = overlay(inst, "FxLowFlash")
	local flash = Instance.new("Frame")
	flash.BackgroundColor3 = color
	flash.BorderSizePixel = 0
	flash.Size = UDim2.fromScale(1, 1)
	flash.Active = false
	flash.Parent = layer
	ctx.loop(function(t)
		flash.BackgroundTransparency = 1 - 0.55 * math.max(0, math.sin(t * speed * 6))
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.barrainbow = function(inst, p, ctx)
	local speed = math.max(0.3, num(p, "speed", 1))
	local fill = findFill(inst)
	if not fill then
		return
	end
	local oldColor = fill.BackgroundColor3
	fill.BackgroundColor3 = Color3.new(1, 1, 1)
	local grad = Instance.new("UIGradient")
	grad.Name = "FxBarRainbow"
	grad.Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 80, 80)),
		ColorSequenceKeypoint.new(0.2, Color3.fromRGB(255, 200, 60)),
		ColorSequenceKeypoint.new(0.4, Color3.fromRGB(120, 255, 120)),
		ColorSequenceKeypoint.new(0.6, Color3.fromRGB(60, 220, 255)),
		ColorSequenceKeypoint.new(0.8, Color3.fromRGB(190, 110, 255)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 80, 80)),
	})
	grad.Parent = fill
	ctx.loop(function(t)
		grad.Offset = Vector2.new(((t * speed * 0.25) % 2) - 1, 0)
	end)
	ctx.cleanup(function()
		grad:Destroy()
		if fill.Parent then
			fill.BackgroundColor3 = oldColor
		end
	end)
end

all.tipspark = function(inst, p, ctx)
	local color = hex(p.color, Color3.new(1, 1, 1))
	local speed = math.max(0.3, num(p, "speed", 1))
	local fill = findFill(inst)
	if not fill then
		return
	end
	local layer = overlay(inst, "FxTipSpark", true)
	local spark = Instance.new("Frame")
	spark.BackgroundColor3 = color
	spark.BorderSizePixel = 0
	spark.AnchorPoint = Vector2.new(0.5, 0.5)
	spark.Active = false
	round(spark)
	spark.Parent = layer
	ctx.loop(function(t)
		local d = math.max(4, inst.AbsoluteSize.Y * 0.9)
		local x = fill.AbsolutePosition.X + fill.AbsoluteSize.X - inst.AbsolutePosition.X
		spark.Position = UDim2.fromOffset(x, inst.AbsoluteSize.Y / 2)
		spark.Size = UDim2.fromOffset(d, d)
		spark.BackgroundTransparency = 0.25 + 0.5 * ((math.sin(t * speed * 9) + 1) / 2)
	end)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.damage = function(inst, p, ctx)
	local trailColor = hex(p.trail, Color3.fromRGB(255, 210, 63))
	local drop = math.clamp(num(p, "drop", 0.35), 0, 0.9)
	local speed = math.max(0.3, num(p, "speed", 1))
	local fill, home = barBase(inst, ctx)
	if not fill then
		return
	end
	local trail = fill:Clone()
	for _, c in ipairs(trail:GetChildren()) do
		c:Destroy()
	end
	trail.Name = "FxDamageTrail"
	trail.BackgroundColor3 = trailColor
	trail.ZIndex = fill.ZIndex - 1
	trail.Parent = fill.Parent
	ctx.cleanup(function()
		trail:Destroy()
	end)
	ctx.loop(function(t)
		local k = ((t * speed) % 4) / 4
		local level, trailLevel = 1, 1
		if k > 0.2 and k < 0.9 then
			level = 1 - drop * math.min(1, (k - 0.2) / 0.08)
			trailLevel = 1 - drop * math.min(1, math.max(0, (k - 0.3) / 0.3))
		elseif k >= 0.9 then
			local r = (k - 0.9) / 0.1
			level = (1 - drop) + drop * r
			trailLevel = level
		end
		fillTo(fill, home, level)
		fillTo(trail, home, math.max(level, trailLevel))
	end)
end

----------------------------------------------------------------------
-- halo: a ring that follows the layer's own shape and grows outward by a few pixels, so wide rows and pills stay pills
----------------------------------------------------------------------
all.figmahalo = function(inst, p, ctx)
	local color = hex(p.color, Color3.fromRGB(255, 213, 74))
	local size = math.clamp(num(p, "size", 1), 0.4, 2.5)
	local speed = math.max(0.2, num(p, "speed", 1))
	local ring = Instance.new("Frame")
	ring.Name = "FxHalo"
	ring.BackgroundTransparency = 1
	ring.BorderSizePixel = 0
	ring.AnchorPoint = Vector2.new(0.5, 0.5)
	ring.Position = UDim2.fromScale(0.5, 0.5)
	ring.Active = false
	ring.ZIndex = inst.ZIndex + 20
	ring.Parent = inst
	local stroke = Instance.new("UIStroke")
	stroke.Color = color
	stroke.Thickness = 3 * size
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Parent = ring
	local hostCorner = inst:FindFirstChildOfClass("UICorner")
	local corner = Instance.new("UICorner")
	corner.Parent = ring
	local base = hostCorner and hostCorner.CornerRadius or UDim.new(0, 0)
	if inst:IsA("GuiObject") and inst.ClipsDescendants then
		inst.ClipsDescendants = false -- the ring sits just outside the layer
	end
	ctx.loop(function(t)
		local k = ((t * speed) / 1.4) % 1
		local reach = math.clamp(math.min(inst.AbsoluteSize.X, inst.AbsoluteSize.Y) * 0.35, 5, 16)
		local grow = 2 + reach * k
		ring.Size = UDim2.new(1, grow * 2, 1, grow * 2)
		corner.CornerRadius = UDim.new(base.Scale, base.Offset + grow)
		stroke.Transparency = math.clamp(0.1 + 0.9 * k, 0, 1)
		stroke.Thickness = math.max(1, 3 * size * (1 - 0.5 * k))
	end)
	ctx.cleanup(function()
		ring:Destroy()
	end)
end

----------------------------------------------------------------------
-- fallbacks: only used when your UIEffects module does not have the effect (or failed)
----------------------------------------------------------------------
all.rays = function(inst, p, ctx)
	local color = hex(p.color, Color3.fromRGB(255, 241, 168))
	local speed = num(p, "speed", 1)
	local holder = Instance.new("Frame")
	holder.Name = "FxRays"
	holder.BackgroundTransparency = 1
	holder.AnchorPoint = Vector2.new(0.5, 0.5)
	holder.Position = UDim2.fromScale(0.5, 0.5)
	holder.Size = UDim2.fromScale(1, 1)
	holder.ZIndex = 0
	holder.Active = false
	holder.Parent = inst
	local count = 12
	for i = 1, count do
		local ray = Instance.new("Frame")
		ray.Name = "Ray"
		ray.BackgroundColor3 = color
		ray.BorderSizePixel = 0
		ray.AnchorPoint = Vector2.new(0, 0.5)
		ray.Position = UDim2.fromScale(0.5, 0.5)
		ray.Rotation = (i - 1) * (360 / count)
		ray.ZIndex = 0
		ray.Active = false
		ray.Parent = holder
		local g = Instance.new("UIGradient")
		g.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.45, 0.75), NumberSequenceKeypoint.new(1, 1) })
		g.Parent = ray
	end
	ctx.loop(function(t)
		local reach = math.max(inst.AbsoluteSize.X, inst.AbsoluteSize.Y) * 0.9
		local w = math.max(4, inst.AbsoluteSize.Y * 0.28)
		for _, ray in ipairs(holder:GetChildren()) do
			ray.Size = UDim2.fromOffset(reach, w)
		end
		holder.Rotation = (t * 12 * speed) % 360
	end)
	ctx.cleanup(function()
		holder:Destroy()
	end)
end

all.bevel = function(inst, p, ctx)
	local depth = math.clamp(num(p, "depth", 3), 1, 12)
	local layer = overlay(inst, "FxBevel")
	local function edge(pos, size, anchor, color, tr)
		local f = Instance.new("Frame")
		f.BackgroundColor3 = color
		f.BackgroundTransparency = tr
		f.BorderSizePixel = 0
		f.AnchorPoint = anchor
		f.Position = pos
		f.Size = size
		f.Active = false
		f.Parent = layer
	end
	edge(UDim2.fromScale(0, 0), UDim2.new(1, 0, 0, depth), Vector2.new(0, 0), Color3.new(1, 1, 1), 0.55)
	edge(UDim2.fromScale(0, 0), UDim2.new(0, depth, 1, 0), Vector2.new(0, 0), Color3.new(1, 1, 1), 0.65)
	edge(UDim2.fromScale(0, 1), UDim2.new(1, 0, 0, depth), Vector2.new(0, 1), Color3.new(0, 0, 0), 0.6)
	edge(UDim2.fromScale(1, 0), UDim2.new(0, depth, 1, 0), Vector2.new(1, 0), Color3.new(0, 0, 0), 0.7)
	ctx.cleanup(function()
		layer:Destroy()
	end)
end

all.textgradient = function(inst, p, ctx)
	if not inst:IsA("TextLabel") and not inst:IsA("TextButton") then
		return
	end
	local keys = {}
	for stop in string.gmatch(tostring(p.stops or "ff6ad5:0|5bc8ff:100"), "[^|]+") do
		local c, at = string.match(stop, "^#?(%x+):?(%d*)$")
		if c then
			table.insert(keys, { hex(c), (tonumber(at) or 0) / 100 })
		end
	end
	if #keys < 2 then
		keys = { { hex("ff6ad5"), 0 }, { hex("5bc8ff"), 1 } }
	end
	table.sort(keys, function(a, b)
		return a[2] < b[2]
	end)
	keys[1][2], keys[#keys][2] = 0, 1
	local seq = {}
	for _, k in ipairs(keys) do
		table.insert(seq, ColorSequenceKeypoint.new(k[2], k[1]))
	end
	inst.TextColor3 = Color3.new(1, 1, 1)
	local g = Instance.new("UIGradient")
	g.Name = "FxTextGradient"
	g.Color = ColorSequence.new(seq)
	g.Rotation = num(p, "angle", 0)
	g.Parent = inst
	ctx.cleanup(function()
		g:Destroy()
	end)
end

----------------------------------------------------------------------
-- running the effects of a layer
----------------------------------------------------------------------
local running = setmetatable({}, { __mode = "k" })
local FALLBACK = { rays = true, bevel = true, textgradient = true }
Extra.fallback = {}

local function apply(inst)
	if running[inst] then
		return
	end
	local fx = inst:GetAttribute("Fx")
	if type(fx) ~= "string" or fx == "" then
		return
	end
	local loops, cleanups, poses = {}, {}, {}
	local alive = true
	local ctx = {
		alive = function()
			return alive
		end,
		cleanup = function(fn)
			table.insert(cleanups, fn)
		end,
		loop = function(fn)
			table.insert(loops, fn)
		end,
		-- every motion effect writes into its own pose; they are added together on the layer
		pose = function()
			local pose = { rot = 0, scale = 1, dx = 0, dy = 0, sx = 1, sy = 1 }
			table.insert(poses, pose)
			return pose
		end,
	}
	local used = false
	for name in string.gmatch(fx, "[^|]+") do
		local key = string.lower(name)
		local fn = all[key]
		if fn and FALLBACK[key] and not Extra.fallback[key] then
			fn = nil -- your UIEffects module already plays this one
		end
		if fn then
			used = true
			local ok, err = pcall(fn, inst, params(inst, key), ctx)
			if not ok then
				warn("[UIEffectsExtra] " .. name .. " on " .. inst:GetFullName() .. ": " .. tostring(err))
			end
		end
	end
	if not used then
		return
	end
	if #poses > 0 then
		local scale = Instance.new("UIScale")
		scale.Name = "FxPose"
		scale.Parent = inst
		local baseRot, basePos, baseSize = inst.Rotation, inst.Position, inst.Size
		local auto = isAuto(inst) -- a list layout decides the position and size, so only rotation and scale move there
		ctx.loop(function()
			local rot, s, dx, dy, sx, sy = 0, 1, 0, 0, 1, 1
			for _, pose in ipairs(poses) do
				rot += pose.rot
				s *= pose.scale
				dx += pose.dx
				dy += pose.dy
				sx *= pose.sx
				sy *= pose.sy
			end
			inst.Rotation = baseRot + rot
			scale.Scale = math.max(0.001, s)
			if not auto then
				inst.Position = basePos + UDim2.fromOffset(dx, dy)
				inst.Size = mulUDim2(baseSize, sx, sy)
			else
				scale.Scale = math.max(0.001, s * (sx + sy) / 2)
			end
		end)
		ctx.cleanup(function()
			scale:Destroy()
			inst.Rotation, inst.Position, inst.Size = baseRot, basePos, baseSize
		end)
	end
	local conn
	if #loops > 0 then
		local started = os.clock()
		conn = RunService.RenderStepped:Connect(function(dt)
			local t = os.clock() - started
			for _, fn in ipairs(loops) do
				fn(t, dt)
			end
		end)
	end
	local function stop()
		alive = false
		if conn then
			conn:Disconnect()
		end
		for i = #cleanups, 1, -1 do
			pcall(cleanups[i])
		end
	end
	running[inst] = { stop = stop }
	inst.Destroying:Once(stop)
end

function Extra.applyTree(root, forceFallback)
	local list = root:GetAttribute("FxFallback")
	for key in pairs(FALLBACK) do
		Extra.fallback[key] = forceFallback == true
	end
	if type(list) == "string" then
		for name in string.gmatch(list, "[^|]+") do
			Extra.fallback[name] = true
		end
	end
	apply(root)
	for _, d in ipairs(root:GetDescendants()) do
		if d:IsA("GuiObject") then
			apply(d)
		end
	end
end

return Extra
]==]

-- finds your existing UIEffects module (the app made one in ReplicatedStorage) and remembers its code
local function findEffectsSource()
	local src = nil
	pcall(function()
		local found = game:GetService("ReplicatedStorage"):FindFirstChild("UIEffects", true)
		if found and found:IsA("ModuleScript") and #found.Source > 0 then
			src = found.Source
		end
	end)
	if src then
		pcall(function()
			plugin:SetSetting("uiEffectsSource", src)
		end)
		return src
	end
	return plugin:GetSetting("uiEffectsSource")
end

-- Your own UIEffects module draws its shine, glass, gloss, shadow-edge and background layers in plain Frames with ClipsDescendants.
-- Roblox only clips to a rectangle there (UICorner is ignored), so on a rounded button they show as a square box.
-- A CanvasGroup clips to the UICorner shape, so the copy that goes into the ScreenGui is patched to use one.
-- Effects that must reach outside the layer (wisp, stars, halo, orbit, border) keep a plain Frame.
-- Nothing changes if the text is not found.
local function replaceOnce(src, old, new)
	local i, j = string.find(src, old, 1, true)
	if not i then
		return src, false
	end
	return string.sub(src, 1, i - 1) .. new .. string.sub(src, j + 1), true
end

local function patchMainEffects(src)
	if not src or string.find(src, "CanvasGroup", 1, true) then
		return src
	end
	src = replaceOnce(
		src,
		'local function overlay(inst, name)\n\tlocal f = Instance.new("Frame")',
		'local function overlay(inst, name)\n\tlocal f = Instance.new((inst:FindFirstChildOfClass("UICorner") and not ({ FxWisp = true, FxStars = true, FxHalo = true, FxOrbit = true, FxBorder = true })[name]) and "CanvasGroup" or "Frame")'
	)
	src = replaceOnce(
		src,
		'local layer = Instance.new("Frame")\n\tlayer.Name = "FxBg"',
		'local layer = Instance.new(inst:FindFirstChildOfClass("UICorner") and "CanvasGroup" or "Frame")\n\tlayer.Name = "FxBg"'
	)
	return src
end

local function addEffectsCode(gui)
	local src = patchMainEffects(findEffectsSource())
	if src then
		local mod = Instance.new("ModuleScript")
		mod.Name = "UIEffects"
		mod.Source = src
		mod.Parent = gui
	end
	local extraMod = Instance.new("ModuleScript")
	extraMod.Name = "UIEffectsExtra"
	extraMod.Source = EXTRA_SOURCE
	extraMod.Parent = gui
	local ls = Instance.new("LocalScript")
	ls.Name = "Effects"
	ls.Source = EFFECTS_LOCALSCRIPT
	ls.Parent = gui
	local missing = {}
	for _, name in ipairs({ "rays", "bevel", "textgradient" }) do
		if not src or not string.find(src, name, 1, true) then
			table.insert(missing, name)
		end
	end
	if #missing > 0 then
		gui:SetAttribute("FxFallback", table.concat(missing, "|"))
	end
	-- effects that neither module has any code for
	local silent = {}
	for name in pairs(fxSeen) do
		local inMain = src and string.find(src, name, 1, true)
		local inExtra = string.find(EXTRA_SOURCE, "all." .. name .. " =", 1, true)
		if not inMain and not inExtra then
			table.insert(silent, name)
		end
	end
	table.sort(silent)
	stats.noCode = table.concat(silent, ", ")
	stats.fxCode = src and "added" or "extraOnly"
end

local function importData(data)
	stats.layers = 0
	stats.images = 0
	stats.fx = 0
	stats.fxCode = ""
	stats.noCode = ""
	fxSeen = {}
	ChangeHistoryService:SetWaypoint("Before Figma import")
	local made = {}
	currentImages = data.imageIds or {}
	stats.notes = data.imageNotes
	for _, screen in ipairs(data.screens) do
		-- replace a ScreenGui we made earlier from the same frame, never touch one you made by hand
		for _, old in ipairs(StarterGui:GetChildren()) do
			if old.Name == cleanName(screen.name, "FigmaGui") and old:GetAttribute("FigmaImported") then
				old:Destroy()
			end
		end
		local fxBefore = stats.fx
		local gui = buildScreen(screen)
		if stats.fx > fxBefore and runEffects then
			addEffectsCode(gui)
		end
		gui.Parent = StarterGui
		table.insert(made, gui)
	end
	Selection:Set(made)
	ChangeHistoryService:SetWaypoint("Figma import")
	return #made
end

----------------------------------------------------------------------
-- talking to the Pixelworks Bridge (cloud server)
----------------------------------------------------------------------
-- the bridge address and login ------------------------------------------------
local B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function base64(data)
	local out = {}
	for i = 1, #data, 3 do
		local a, b, c = string.byte(data, i, i + 2)
		local n = a * 65536 + (b or 0) * 256 + (c or 0)
		local c1 = math.floor(n / 262144) % 64
		local c2 = math.floor(n / 4096) % 64
		local c3 = math.floor(n / 64) % 64
		local c4 = n % 64
		out[#out + 1] = string.sub(B64CHARS, c1 + 1, c1 + 1) .. string.sub(B64CHARS, c2 + 1, c2 + 1)
			.. (b and string.sub(B64CHARS, c3 + 1, c3 + 1) or "=") .. (c and string.sub(B64CHARS, c4 + 1, c4 + 1) or "=")
	end
	return table.concat(out)
end

-- sets BASE and the login from what was typed; returns the cleaned address ("" when empty)
local function applyConnection(url, user, pass)
	url = string.gsub(tostring(url or ""), "%s+", "")
	url = string.gsub(url, "/+$", "")
	url = string.gsub(url, "/figma%-bridge$", "")
	if url ~= "" and not string.find(url, "^https?://") then
		url = "https://" .. url
	end
	if url == "" then
		BASE, authHeader = "", nil
		return ""
	end
	BASE = url .. "/figma-bridge"
	authHeader = "Basic " .. base64(tostring(user or "") .. ":" .. tostring(pass or ""))
	return url
end

applyConnection(plugin:GetSetting("bridgeUrl"), plugin:GetSetting("bridgeUser"), plugin:GetSetting("bridgePass"))

local function request(path)
	if BASE == "" then
		return nil, "Set the bridge address and login first: open \"Connection\" at the top."
	end
	local ok, res = pcall(function()
		return HttpService:RequestAsync({ Url = BASE .. path, Method = "GET", Headers = { Authorization = authHeader } })
	end)
	if not ok then
		local msg = tostring(res)
		if string.find(string.lower(msg), "http requests are not enabled") then
			return nil, "HTTP is off. Game Settings > Security > turn on \"Allow HTTP Requests\"."
		end
		if string.find(string.lower(msg), "permission") then
			return nil, "Studio is waiting for permission. Click Allow on the plugin's pop-up, then try again."
		end
		return nil, "Can't reach the bridge. Check the address (a sleeping Render server needs about a minute to wake up). (" .. msg .. ")"
	end
	if not res.Success then
		if res.StatusCode == 401 then
			return nil, "Wrong bridge username or password."
		end
		if res.StatusCode == 429 then
			return nil, "Too many wrong logins. Wait 15 minutes, then try again."
		end
		return nil, "The bridge answered " .. tostring(res.StatusCode) .. "."
	end
	local ok2, decoded = pcall(function()
		return HttpService:JSONDecode(res.Body)
	end)
	if not ok2 then
		return nil, "The bridge sent something unreadable."
	end
	return decoded
end

local function postJson(path, tbl)
	if BASE == "" then
		return nil, "Set the bridge address and login first: open \"Connection\" at the top."
	end
	local ok, res = pcall(function()
		return HttpService:RequestAsync({
			Url = BASE .. path,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json", Authorization = authHeader },
			Body = HttpService:JSONEncode(tbl),
		})
	end)
	if not ok then
		return nil, "Can't reach the bridge. Check the address (a sleeping Render server needs about a minute to wake up). (" .. tostring(res) .. ")"
	end
	local okd, decoded = pcall(function()
		return HttpService:JSONDecode(res.Body)
	end)
	if not res.Success then
		if res.StatusCode == 401 then
			return nil, "Wrong bridge username or password."
		end
		return nil, (okd and decoded and decoded.error) or ("The bridge answered " .. tostring(res.StatusCode) .. ".")
	end
	if not okd then
		return nil, "The bridge sent something unreadable."
	end
	return decoded
end

----------------------------------------------------------------------
-- the panel
----------------------------------------------------------------------
local toolbar = plugin:CreateToolbar("Figma > Studio")
local button = toolbar:CreateButton("FigmaImport", "Pick frames from your Figma file and import them as a GUI (" .. VERSION .. ")", "rbxassetid://4458901886", "Figma GUI")
button.ClickableWhenViewportHidden = true

local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 340, 690, 300, 540)
local widget = plugin:CreateDockWidgetPluginGui("FigmaToStudioWidget", info)
widget.Title = "Figma > Studio  " .. VERSION

local bg = Instance.new("Frame")
bg.Size = UDim2.fromScale(1, 1)
bg.BackgroundColor3 = Color3.fromRGB(34, 32, 52)
bg.BorderSizePixel = 0
bg.Parent = widget

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 10)
padding.PaddingLeft = UDim.new(0, 10)
padding.PaddingRight = UDim.new(0, 10)
padding.PaddingBottom = UDim.new(0, 10)
padding.Parent = bg

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 6)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = bg

local PURPLE = Color3.fromRGB(70, 66, 104)
local BLUE = Color3.fromRGB(72, 120, 255)

local function rounded(inst, r)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, r or 6)
	c.Parent = inst
end

local function makeButton(text, order, color, height)
	local b = Instance.new("TextButton")
	b.Size = UDim2.new(1, 0, 0, height or 30)
	b.BackgroundColor3 = color
	b.TextColor3 = Color3.new(1, 1, 1)
	b.Font = Enum.Font.GothamBold
	b.TextSize = 13
	b.Text = text
	b.AutoButtonColor = true
	b.LayoutOrder = order
	b.BorderSizePixel = 0
	rounded(b, 6)
	return b
end

-- header: which Figma file / page, and a Refresh button
local headerRow = Instance.new("Frame")
headerRow.Size = UDim2.new(1, 0, 0, 30)
headerRow.BackgroundTransparency = 1
headerRow.LayoutOrder = 1
headerRow.Parent = bg

local headerLabel = Instance.new("TextLabel")
headerLabel.Size = UDim2.new(1, -80, 1, 0)
headerLabel.BackgroundTransparency = 1
headerLabel.TextColor3 = Color3.new(1, 1, 1)
headerLabel.Font = Enum.Font.GothamBold
headerLabel.TextSize = 13
headerLabel.TextXAlignment = Enum.TextXAlignment.Left
headerLabel.TextTruncate = Enum.TextTruncate.AtEnd
headerLabel.Text = "Frames in Figma"
headerLabel.Parent = headerRow

local refreshButton = makeButton("Refresh", 1, PURPLE, 30)
refreshButton.Size = UDim2.new(0, 72, 1, 0)
refreshButton.Position = UDim2.new(1, -72, 0, 0)
refreshButton.Parent = headerRow

-- the list of frames, each one tickable
local listFrame = Instance.new("ScrollingFrame")
listFrame.Size = UDim2.new(1, 0, 0, 130)
listFrame.BackgroundColor3 = Color3.fromRGB(24, 22, 40)
listFrame.BorderSizePixel = 0
listFrame.ScrollBarThickness = 6
listFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
listFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
listFrame.LayoutOrder = 2
rounded(listFrame, 6)
local listLayout = Instance.new("UIListLayout")
listLayout.Padding = UDim.new(0, 3)
listLayout.SortOrder = Enum.SortOrder.LayoutOrder
listLayout.Parent = listFrame
local listPad = Instance.new("UIPadding")
listPad.PaddingTop = UDim.new(0, 4)
listPad.PaddingLeft = UDim.new(0, 4)
listPad.PaddingRight = UDim.new(0, 4)
listPad.PaddingBottom = UDim.new(0, 4)
listPad.Parent = listFrame
listFrame.Parent = bg

-- quick pick buttons
local pickRow = Instance.new("Frame")
pickRow.Size = UDim2.new(1, 0, 0, 28)
pickRow.BackgroundTransparency = 1
pickRow.LayoutOrder = 3
pickRow.Parent = bg
local pickLayout = Instance.new("UIListLayout")
pickLayout.FillDirection = Enum.FillDirection.Horizontal
pickLayout.Padding = UDim.new(0, 6)
pickLayout.SortOrder = Enum.SortOrder.LayoutOrder
pickLayout.Parent = pickRow
local allButton = makeButton("All", 1, PURPLE, 28)
allButton.Size = UDim2.new(0.2, -4, 1, 0)
allButton.Parent = pickRow
local noneButton = makeButton("None", 2, PURPLE, 28)
noneButton.Size = UDim2.new(0.2, -4, 1, 0)
noneButton.Parent = pickRow
local selButton = makeButton("Figma selection", 3, PURPLE, 28)
selButton.Size = UDim2.new(0.6, -4, 1, 0)
selButton.Parent = pickRow

local importButton = makeButton("Import selected", 4, BLUE, 34)
importButton.Parent = bg
local modeButton = makeButton(MODE_TEXT[mode], 5, PURPLE, 28)
modeButton.Parent = bg
local textButton = makeButton("Text size: " .. math.floor(textScale * 100 + 0.5) .. "%", 6, PURPLE, 28)
textButton.Parent = bg
local sizeButton = makeButton("Screen size: " .. math.floor(sizeFactor * 100 + 0.5) .. "%", 7, PURPLE, 28)
sizeButton.Parent = bg
local fxButton = makeButton("Play effects: " .. (runEffects and "on" or "off"), 8, PURPLE, 28)
fxButton.Parent = bg
local bgButton = makeButton("Tiled background: " .. (tiledBg and "on" or "off"), 9, PURPLE, 28)
bgButton.Parent = bg
local lastButton = makeButton("Import what was sent from Figma", 10, PURPLE, 28)
lastButton.Parent = bg
local autoButton = makeButton("Auto-import sent frames: off", 11, PURPLE, 28)
autoButton.Parent = bg

local status = Instance.new("TextLabel")
status.Size = UDim2.new(1, 0, 0, 70)
status.BackgroundTransparency = 1
status.TextColor3 = Color3.fromRGB(200, 196, 230)
status.Font = Enum.Font.Gotham
status.TextSize = 13
status.TextWrapped = true
status.TextXAlignment = Enum.TextXAlignment.Left
status.TextYAlignment = Enum.TextYAlignment.Top
status.LayoutOrder = 12
status.Text = BASE == "" and "First open Connection (top) and type your bridge address, username and password." or "Open your file in Figma and run the Pixelworks Bridge plugin, then pick frames above."
status.Parent = bg

local function setStatus(text)
	status.Text = text
end

local verLabel = Instance.new("TextLabel")
verLabel.Size = UDim2.new(1, 0, 0, 16)
verLabel.BackgroundTransparency = 1
verLabel.TextColor3 = Color3.fromRGB(140, 136, 175)
verLabel.Font = Enum.Font.Gotham
verLabel.TextSize = 11
verLabel.TextXAlignment = Enum.TextXAlignment.Right
verLabel.LayoutOrder = 13
verLabel.Text = "Studio plugin " .. VERSION
verLabel.Parent = bg

-- Connection: the bridge address and login, saved between sessions (on this computer only)
do
	local panel = Instance.new("Frame")
	panel.Name = "ConnectionPanel"
	panel.Size = UDim2.new(1, 0, 0, 0)
	panel.AutomaticSize = Enum.AutomaticSize.Y
	panel.BackgroundTransparency = 1
	panel.LayoutOrder = -1
	panel.Visible = BASE == ""
	panel.Parent = bg
	local panelLayout = Instance.new("UIListLayout")
	panelLayout.Padding = UDim.new(0, 4)
	panelLayout.SortOrder = Enum.SortOrder.LayoutOrder
	panelLayout.Parent = panel

	local function field(placeholder, order, saved)
		local t = Instance.new("TextBox")
		t.Size = UDim2.new(1, 0, 0, 26)
		t.BackgroundColor3 = Color3.fromRGB(38, 36, 58)
		t.TextColor3 = Color3.new(1, 1, 1)
		t.PlaceholderText = placeholder
		t.PlaceholderColor3 = Color3.fromRGB(140, 136, 175)
		t.Font = Enum.Font.Gotham
		t.TextSize = 13
		t.TextXAlignment = Enum.TextXAlignment.Left
		t.ClearTextOnFocus = false
		t.Text = tostring(saved or "")
		t.LayoutOrder = order
		t.BorderSizePixel = 0
		rounded(t, 6)
		local pad = Instance.new("UIPadding")
		pad.PaddingLeft = UDim.new(0, 8)
		pad.Parent = t
		t.Parent = panel
		return t
	end

	local urlBox = field("https://your-bridge.onrender.com", 1, plugin:GetSetting("bridgeUrl"))
	local userBox = field("Username", 2, plugin:GetSetting("bridgeUser"))
	local passBox = field("Password", 3, "")

	-- Roblox text boxes cannot hide what is typed, so the box shows dots and the real password is kept here
	local BULLET = "\u{2022}"
	local realPass = tostring(plugin:GetSetting("bridgePass") or "")
	local masking = false
	local function mask()
		masking = true
		passBox.Text = string.rep(BULLET, utf8.len(realPass) or #realPass)
		masking = false
	end
	mask()
	passBox:GetPropertyChangedSignal("Text"):Connect(function()
		if masking then
			return
		end
		local t = passBox.Text
		local n = utf8.len(t) or #t
		local keep = 0
		for _, cp in utf8.codes(t) do
			if cp == 8226 then
				keep += 1
			else
				break
			end
		end
		local realLen = utf8.len(realPass) or #realPass
		if n < realLen and keep == n then
			local cut = utf8.offset(realPass, n + 1)
			realPass = cut and string.sub(realPass, 1, cut - 1) or realPass
		else
			local headEnd = utf8.offset(realPass, keep + 1)
			local head = keep > 0 and string.sub(realPass, 1, (headEnd or (#realPass + 1)) - 1) or ""
			local tailStart = utf8.offset(t, keep + 1)
			realPass = head .. (tailStart and string.sub(t, tailStart) or "")
		end
		mask()
	end)

	local saveBtn = makeButton("Save and connect", 4, BLUE, 28)
	saveBtn.Parent = panel

	local toggle = makeButton("Connection (bridge address + login)", -2, PURPLE, 24)
	toggle.Parent = bg
	toggle.Activated:Connect(function()
		panel.Visible = not panel.Visible
	end)

	saveBtn.Activated:Connect(function()
		local url = applyConnection(urlBox.Text, userBox.Text, realPass)
		if url == "" then
			setStatus("Type your bridge address first, for example https://your-bridge.onrender.com")
			return
		end
		if string.find(url, "^http://") and not string.find(url, "^http://localhost") and not string.find(url, "^http://127%.0%.0%.1") then
			BASE, authHeader = "", nil
			setStatus("Use an https:// address, so your password is not sent in the clear.")
			return
		end
		urlBox.Text = url
		plugin:SetSetting("bridgeUrl", url)
		plugin:SetSetting("bridgeUser", userBox.Text)
		plugin:SetSetting("bridgePass", realPass)
		panel.Visible = false
		setStatus("Saved. Press Refresh to connect.")
	end)
end

----------------------------------------------------------------------
-- frame list state
----------------------------------------------------------------------
local frameList = {} -- { {id=, name=}, ... } in Figma order
local picked = {} -- id -> true
local figmaSelected = {} -- ids selected in Figma right now
local rowsSig = ""
local firstLoad = true
local busy = false

local function renderRows()
	for _, c in ipairs(listFrame:GetChildren()) do
		if c:IsA("TextButton") then
			c:Destroy()
		end
	end
	for i, f in ipairs(frameList) do
		local on = picked[f.id] == true
		local row = Instance.new("TextButton")
		row.Size = UDim2.new(1, -8, 0, 26)
		row.LayoutOrder = i
		row.BackgroundColor3 = on and BLUE or Color3.fromRGB(58, 54, 88)
		row.TextColor3 = Color3.new(1, 1, 1)
		row.Font = Enum.Font.GothamMedium
		row.TextSize = 13
		row.TextXAlignment = Enum.TextXAlignment.Left
		row.TextTruncate = Enum.TextTruncate.AtEnd
		row.Text = (on and "  [x]  " or "  [ ]  ") .. f.name
		row.BorderSizePixel = 0
		rounded(row, 5)
		row.Parent = listFrame
		row.MouseButton1Click:Connect(function()
			if picked[f.id] then
				picked[f.id] = nil
			else
				picked[f.id] = true
			end
			renderRows()
		end)
	end
end

local function refreshFrames(quiet)
	local res, err = request("/frames")
	if not res then
		if not quiet then
			setStatus(err)
		end
		return
	end
	local ctx = res.context
	if not res.connected or not ctx then
		headerLabel.Text = "Figma plugin not connected"
		if not quiet then
			setStatus("Open your file in Figma and run Plugins > Development > Pixelworks Bridge, then press Refresh.")
		end
		return
	end
	headerLabel.Text = (ctx.fileName or "Figma file") .. " / " .. (ctx.page or "")
	figmaSelected = ctx.selected or {}
	local frames = ctx.frames or {}
	local sig, alive = {}, {}
	for _, f in ipairs(frames) do
		table.insert(sig, f.id .. "=" .. f.name)
		alive[f.id] = true
	end
	for id in pairs(picked) do
		if not alive[id] then
			picked[id] = nil
		end
	end
	if firstLoad then
		firstLoad = false
		for _, id in ipairs(figmaSelected) do
			if alive[id] then
				picked[id] = true
			end
		end
		rowsSig = "" -- force a redraw with the new ticks
	end
	local joined = table.concat(sig, "|")
	if joined ~= rowsSig then
		rowsSig = joined
		frameList = frames
		renderRows()
	end
	if #frames == 0 and not quiet then
		setStatus("This Figma page has no top-level frames.")
	elseif not quiet then
		setStatus("Tick the frames you want, then press Import selected.")
	end
end

local function doImport(force)
	if busy then
		return
	end
	busy = true
	local res, err = request("/gui?v=" .. tostring(force and 0 or lastVersion))
	if not res then
		setStatus(err)
		busy = false
		return
	end
	if res.empty then
		setStatus("Nothing was sent from Figma yet. Pick frames above, or press Send in the plugin's Studio tab.")
	elseif res.same then
		setStatus("Already up to date. Send again from Figma to change it.")
	elseif res.data then
		local ok, result = pcall(importData, res.data)
		if ok then
			lastVersion = res.v
			local extra = ""
			if stats.images > 0 then
				extra = " " .. stats.images .. " picture slot(s) are empty: set their Image in Properties."
			end
			if stats.notes and #stats.notes > 0 then
				extra = extra .. " " .. table.concat(stats.notes, " ")
			end
			if stats.fx > 0 and not runEffects then
				extra = extra .. " Effects are off (they can move layers while playing): turn on \"Play effects\" to try them."
			end
			if stats.fxCode == "added" then
				extra = extra .. " Effects code added inside the ScreenGui (plays when you press Play)."
			elseif stats.fxCode == "extraOnly" then
				extra = extra .. " Your UIEffects module wasn't found, so only the built-in effects (UIEffectsExtra) will play. Copy the UIEffects ModuleScript (ReplicatedStorage > FigmaUI) once and import again for the rest."
			elseif stats.fxCode == "missing" then
				extra = extra .. " Effects were tagged but your UIEffects module wasn't found, so they won't play yet: copy the UIEffects ModuleScript (ReplicatedStorage > FigmaUI) once and import again."
			end
			if stats.noCode and stats.noCode ~= "" then
				extra = extra .. " No code for these tags, so they do nothing: " .. stats.noCode .. "."
			end
			setStatus("Done: " .. result .. " ScreenGui(s), " .. stats.layers .. " layers, now in StarterGui." .. extra)
		else
			setStatus("Import failed: " .. tostring(result))
		end
	end
	busy = false
end

-- ask the app for the ticked frames, wait for Figma to answer, then build them
local function importPicked()
	if busy then
		return
	end
	local ids = {}
	for _, f in ipairs(frameList) do
		if picked[f.id] then
			table.insert(ids, f.id)
		end
	end
	if #ids == 0 then
		setStatus("Tick at least one frame in the list first.")
		return
	end
	busy = true
	setStatus("Asking Figma for " .. #ids .. " frame(s)...")
	local r, err = postJson("/gui-request", { ids = ids })
	if not r then
		setStatus(err)
		busy = false
		return
	end
	if r.pluginConnected == false then
		setStatus("The Figma plugin doesn't look connected. Open Pixelworks Bridge in Figma. Still waiting...")
	end
	local deadline = os.clock() + 60
	local got = false
	while os.clock() < deadline do
		task.wait(0.5)
		local s = request("/gui/status")
		if s then
			if s.busy then
				deadline = math.max(deadline, os.clock() + 30) -- uploading pictures can take a while
				setStatus(tostring(s.busy) .. "")
			end
			if s.err and s.err.req == r.id then
				setStatus("Figma could not send it: " .. tostring(s.err.error))
				busy = false
				return
			end
			if s.req == r.id and s.has then
				got = true
				break
			end
		end
	end
	busy = false
	if not got then
		setStatus("Figma did not answer in time. Is the Pixelworks Bridge plugin open in Figma?")
		return
	end
	doImport(true)
end

----------------------------------------------------------------------
-- buttons
----------------------------------------------------------------------
refreshButton.MouseButton1Click:Connect(function()
	refreshFrames(false)
end)

allButton.MouseButton1Click:Connect(function()
	for _, f in ipairs(frameList) do
		picked[f.id] = true
	end
	renderRows()
end)

noneButton.MouseButton1Click:Connect(function()
	picked = {}
	renderRows()
end)

selButton.MouseButton1Click:Connect(function()
	refreshFrames(true)
	picked = {}
	for _, id in ipairs(figmaSelected) do
		picked[id] = true
	end
	renderRows()
	if #figmaSelected == 0 then
		setStatus("Nothing is selected in Figma right now.")
	end
end)

importButton.MouseButton1Click:Connect(importPicked)

lastButton.MouseButton1Click:Connect(function()
	doImport(true)
end)

modeButton.MouseButton1Click:Connect(function()
	local idx = table.find(MODES, mode) or 1
	mode = MODES[(idx % #MODES) + 1]
	plugin:SetSetting("figmaMode", mode)
	modeButton.Text = MODE_TEXT[mode]
	setStatus("Sizing changed. Press Import again to rebuild with it.")
end)

textButton.MouseButton1Click:Connect(function()
	local idx = table.find(TEXT_SCALES, textScale) or 2
	textScale = TEXT_SCALES[(idx % #TEXT_SCALES) + 1]
	plugin:SetSetting("figmaTextScale", textScale)
	textButton.Text = "Text size: " .. math.floor(textScale * 100 + 0.5) .. "%"
	setStatus("Text size changed. Press Import again to rebuild with it.")
end)

sizeButton.MouseButton1Click:Connect(function()
	local idx = table.find(SIZE_FACTORS, sizeFactor) or 1
	sizeFactor = SIZE_FACTORS[(idx % #SIZE_FACTORS) + 1]
	plugin:SetSetting("figmaSizeFactor", sizeFactor)
	sizeButton.Text = "Screen size: " .. math.floor(sizeFactor * 100 + 0.5) .. "%"
	setStatus("Press Import again to rebuild at this size.")
end)

fxButton.MouseButton1Click:Connect(function()
	runEffects = not runEffects
	plugin:SetSetting("figmaRunEffects", runEffects)
	fxButton.Text = "Play effects: " .. (runEffects and "on" or "off")
	setStatus("Press Import again to rebuild with this.")
end)

bgButton.MouseButton1Click:Connect(function()
	tiledBg = not tiledBg
	plugin:SetSetting("figmaTiledBg", tiledBg)
	bgButton.Text = "Tiled background: " .. (tiledBg and "on" or "off")
	setStatus("Press Import again to rebuild with this.")
end)

local auto = false
autoButton.MouseButton1Click:Connect(function()
	auto = not auto
	autoButton.Text = auto and "Auto-import sent frames: on" or "Auto-import sent frames: off"
	if auto then
		setStatus("Waiting for the next Send from Figma...")
	end
end)

task.spawn(function()
	local tick = 0
	while true do
		task.wait(2)
		tick = tick + 1
		if widget.Enabled and not busy then
			refreshFrames(true) -- keeps the list in step with Figma
			if auto then
				local res = request("/gui?v=" .. tostring(lastVersion))
				if res and res.data then
					doImport(false)
				end
			end
		end
	end
end)

button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)
widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	button:SetActive(widget.Enabled)
	if widget.Enabled then
		refreshFrames(false)
	end
end)
