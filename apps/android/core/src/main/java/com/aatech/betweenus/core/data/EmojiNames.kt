package com.aatech.betweenus.core.data

/**
 * Shortcodes for the curated set, so `:` can find one by name.
 *
 * The port of `apps/desktop/src/features/chat/emoji-names.ts`, table and all,
 * and it has to stay a port: a shortcode is a shared contract between the
 * clients, so a name only this one knows produces a message the others show as
 * the word somebody typed.
 *
 * The table is about six kilobytes of text against the ~1.5 MB an emoji
 * package brings, and it works offline with no sprite sheet to load. One
 * `emoji:name` per entry, whitespace-separated, aliases appended after further
 * colons - `thumbsup:+1:yes`.
 */
object EmojiNames {

    private val TABLE = """
😀:grinning 😃:smiley 😄:smile 😁:grin 😆:laughing:satisfied 😅:sweat_smile
😂:joy:lol 🤣:rofl:rolling 😊:blush 😇:innocent:angel 🙂:slightly_smiling
🙃:upside_down 😉:wink 😌:relieved 😍:heart_eyes 🥰:smiling_face_with_hearts
😘:kissing_heart 😗:kissing 😙:kissing_smiling_eyes 😚:kissing_closed_eyes
😋:yum 😛:stuck_out_tongue 😝:stuck_out_tongue_closed_eyes 😜:stuck_out_tongue_wink
🤪:zany 🤨:raised_eyebrow 🧐:monocle 🤓:nerd 😎:sunglasses:cool 🥳:partying
😏:smirk 😒:unamused 😞:disappointed 😔:pensive 😟:worried 😕:confused
🙁:slightly_frowning 😣:persevere 😖:confounded 😫:tired 😩:weary 🥺:pleading
😢:cry:sad 😭:sob:crying 😤:triumph:huff 😠:angry 😡:rage:mad 🤬:cursing
🤯:exploding_head:mindblown 😳:flushed 🥵:hot 🥶:cold 😱:scream 😨:fearful
😰:anxious 😥:sad_relieved 😓:sweat 🤗:hugs 🤔:thinking:think 🤭:hand_over_mouth
🤫:shushing:quiet 🤥:lying 😶:no_mouth 😐:neutral 😑:expressionless 😬:grimacing
🙄:roll_eyes 😯:hushed 😦:frowning 😧:anguished 😮:open_mouth 😲:astonished
🥱:yawning 😴:sleeping 🤤:drooling 😪:sleepy 😵:dizzy_face 🤐:zipper_mouth
🥴:woozy 🤢:nauseated 🤮:vomiting 🤧:sneezing 😷:mask 🤒:thermometer_face
🤕:head_bandage 🤑:money_mouth 🤠:cowboy 😈:smiling_imp 👿:imp 💀:skull
👻:ghost 👽:alien 🤖:robot:bot 💩:poop 🙈:see_no_evil 🙉:hear_no_evil 🙊:speak_no_evil

👍:thumbsup:+1:yes 👎:thumbsdown:-1:no 👊:fist_bump ✊:fist 🤛:left_fist 🤜:right_fist
👏:clap 🙌:raised_hands 👐:open_hands 🤲:palms_up 🤝:handshake:deal 🙏:pray:thanks
✌️:v:peace 🤞:fingers_crossed 🤟:love_you 🤘:metal:rock 👌:ok_hand 🤌:pinched
🤏:pinching 👈:point_left 👉:point_right 👆:point_up 👇:point_down ☝️:index_up
✋:hand:stop 🤚:raised_back_of_hand 🖐️:splayed 🖖:vulcan 👋:wave:hello 🤙:call_me
💪:muscle:flex 🦾:mechanical_arm ✍️:writing 💅:nail_care 👀:eyes:look 👁️:eye 👣:footprints

👶:baby 🧒:child 👦:boy 👧:girl 🧑:person 👨:man 👩:woman 🧓:older_person
👴:old_man 👵:old_woman 🧑‍💻:technologist:developer 👨‍💻:man_technologist
👩‍💻:woman_technologist 🧑‍🔧:mechanic 🧑‍🚀:astronaut 🥷:ninja 🦸:superhero
🦹:supervillain 🧙:mage:wizard 🧑‍🎓:student:graduate 💂:guard 👮:police
🕵️:detective 👷:construction_worker 🧑‍🍳:cook:chef 🧑‍🌾:farmer 🧑‍🏫:teacher
🧑‍⚖️:judge 🤵:person_in_tuxedo 👰:person_with_veil

🐶:dog 🐱:cat 🐭:mouse 🐹:hamster 🐰:rabbit 🦊:fox 🐻:bear 🐼:panda 🐨:koala
🐯:tiger 🦁:lion 🐮:cow 🐷:pig 🐸:frog 🐵:monkey_face 🐔:chicken 🐧:penguin
🐦:bird 🐤:baby_chick 🦆:duck 🦅:eagle 🦉:owl 🦇:bat 🐺:wolf 🐗:boar 🐴:horse
🦄:unicorn 🐝:bee 🐛:bug 🦋:butterfly 🐌:snail 🐞:ladybug 🐜:ant 🕷️:spider
🦂:scorpion 🐢:turtle 🐍:snake 🦎:lizard 🦖:t_rex:dino 🐙:octopus 🦑:squid
🦀:crab 🐟:fish 🐬:dolphin 🐳:whale 🦈:shark 🐊:crocodile 🐅:leopard 🦓:zebra
🦍:gorilla 🐘:elephant 🦏:rhino 🐪:camel 🦒:giraffe 🐄:cow2 🐖:pig2 🐑:sheep
🐕:dog2 🐈:cat2 🕊️:dove

🍏:green_apple 🍎:apple 🍐:pear 🍊:tangerine 🍋:lemon 🍌:banana 🍉:watermelon
🍇:grapes 🍓:strawberry 🫐:blueberries 🍈:melon 🍒:cherries 🍑:peach 🥭:mango
🍍:pineapple 🥥:coconut 🥝:kiwi 🍅:tomato 🥑:avocado 🍆:aubergine:eggplant
🥔:potato 🥕:carrot 🌽:corn 🌶️:hot_pepper 🥒:cucumber 🥬:leafy_green 🥦:broccoli
🧄:garlic 🧅:onion 🍄:mushroom 🥜:peanuts 🌰:chestnut 🍞:bread 🥐:croissant
🥖:baguette 🥨:pretzel 🧀:cheese 🥚:egg 🍳:fried_egg 🧈:butter 🥞:pancakes
🧇:waffle 🥓:bacon 🍔:burger 🍟:fries 🍕:pizza 🌭:hotdog 🥪:sandwich 🌮:taco
🌯:burrito 🥙:wrap 🍜:ramen:noodles 🍲:stew 🍛:curry 🍣:sushi 🍱:bento 🥟:dumpling
🍤:fried_shrimp 🍚:rice 🍰:cake 🎂:birthday 🧁:cupcake 🍪:cookie 🍫:chocolate
🍬:candy 🍭:lollipop 🍩:doughnut ☕:coffee 🍵:tea 🧋:bubble_tea 🍺:beer 🍻:beers
🥂:champagne 🍷:wine 🥃:whisky 🧃:juice 🧊:ice

⚽:soccer:football 🏀:basketball 🏈:american_football ⚾:baseball 🎾:tennis
🏐:volleyball 🏉:rugby 🎱:8ball:pool 🏓:ping_pong 🏸:badminton 🥅:goal 🏒:hockey
🏑:field_hockey 🥍:lacrosse 🏏:cricket ⛳:golf 🏹:bow_and_arrow 🎣:fishing
🥊:boxing 🥋:martial_arts 🎽:running_shirt 🛹:skateboard 🛼:roller_skate 🛷:sled
⛸️:ice_skate 🎿:ski 🏂:snowboard 🏋️:lifting 🤼:wrestling 🤸:cartwheel
⛹️:bouncing_ball 🤺:fencing 🏊:swimming 🏄:surfing 🚴:cycling 🚵:mountain_biking
🧗:climbing 🎮:video_game:gaming 🕹️:joystick 🎲:game_die:dice 🧩:puzzle 🎯:dart
🎳:bowling 🎭:performing_arts 🎨:art 🎬:clapper:film 🎤:microphone 🎧:headphones
🎸:guitar 🥁:drum 🎹:musical_keyboard 🎺:trumpet 🎻:violin 🏆:trophy 🥇:first_place
🥈:second_place 🥉:third_place 🎉:tada:party 🎊:confetti 🎈:balloon

🚗:car 🚕:taxi 🚙:suv 🚌:bus 🚎:trolleybus 🏎️:racing_car 🚓:police_car
🚑:ambulance 🚒:fire_engine 🚚:truck 🚛:lorry 🚜:tractor 🛵:scooter
🏍️:motorcycle 🚲:bike 🛴:kick_scooter 🚨:siren 🚔:oncoming_police_car
🚂:locomotive 🚆:train 🚇:metro 🚊:tram 🚉:station ✈️:airplane 🛫:takeoff
🛬:landing 🚀:rocket:ship 🛸:ufo 🚁:helicopter ⛵:sailboat 🚤:speedboat
🛳️:passenger_ship ⚓:anchor 🏝️:desert_island 🏔️:snow_mountain ⛰️:mountain
🌋:volcano 🏕️:camping 🏖️:beach 🏙️:cityscape 🌃:night_city 🌉:bridge 🗼:tower
🗽:statue_of_liberty 🎡:ferris_wheel 🎢:roller_coaster 🎠:carousel 🗺️:map
🧭:compass ⛺:tent

💻:laptop:computer 🖥️:desktop ⌨️:keyboard 🖱️:mouse_three_button 🖨️:printer
📱:phone:mobile ☎️:telephone 📷:camera 🎥:movie_camera 📺:tv 🔋:battery
🔌:plug 💡:bulb:idea 🔦:flashlight 🕯️:candle 🧰:toolbox 🔧:wrench 🔨:hammer
⚙️:gear:settings 🧲:magnet 🔒:lock 🔓:unlock 🔑:key 🗝️:old_key 🚪:door
🪑:chair 🛏️:bed 🚿:shower 🧴:lotion 🧻:toilet_paper 📦:package 📫:mailbox
📮:postbox 📝:memo:note 📄:page 📚:books 📖:book 🔖:bookmark 📎:paperclip
📌:pushpin 📍:round_pushpin ✂️:scissors 📅:date 📆:calendar 🗓️:spiral_calendar
📊:bar_chart 📈:chart_up 📉:chart_down 💰:money_bag 💳:credit_card 💎:gem
⚖️:balance_scale 🧪:test_tube 🔬:microscope 🔭:telescope 💊:pill 💉:syringe
🩺:stethoscope 🛡️:shield 🏳️:white_flag

❤️:heart:red_heart 🧡:orange_heart 💛:yellow_heart 💚:green_heart 💙:blue_heart
💜:purple_heart 🖤:black_heart 🤍:white_heart 🤎:brown_heart 💔:broken_heart
❣️:heart_exclamation 💕:two_hearts 💞:revolving_hearts 💓:beating_heart
💗:growing_heart 💖:sparkling_heart 💘:cupid 💝:gift_heart ✨:sparkles ⭐:star
🌟:star2:glowing_star 💫:dizzy ⚡:zap:lightning 🔥:fire:flame 💥:boom:collision
☄️:comet 🌈:rainbow ☀️:sunny:sun 🌤️:sun_behind_cloud ☁️:cloud 🌧️:rain
⛈️:thunderstorm ❄️:snowflake 💧:droplet 🌊:ocean:sea:water ✅:white_check_mark:done
❌:x:cross ❓:question ❗:exclamation ⚠️:warning ♻️:recycle 🔰:beginner
💯:100:hundred 🔔:bell 🔕:no_bell 🎵:musical_note 🎶:notes ➕:plus ➖:minus
✔️:heavy_check_mark 🚫:no_entry_sign 🆗:ok 🆕:new 🔜:soon 🔝:top 🕐:clock
⏰:alarm_clock ⏳:hourglass 💤:zzz
"""

    /** The first name is the one shown; the rest also match. */
    data class Named(val emoji: String, val names: List<String>)

    /** The table, parsed once. */
    val ALL: List<Named> by lazy {
        TABLE.split(' ', '\n', '\t')
            .filter { it.isNotBlank() }
            .mapNotNull { entry ->
                val parts = entry.split(":")
                val emoji = parts.firstOrNull().orEmpty()
                val names = parts.drop(1).filter { it.isNotEmpty() }
                // An entry with no name is a typo in the table, not a thing to draw.
                if (emoji.isEmpty() || names.isEmpty()) null else Named(emoji, names)
            }
    }

    /** How many suggestions a `:` menu shows. More than this is a scroll, not a menu. */
    const val SUGGESTION_LIMIT = 8

    /**
     * Emoji whose name matches what has been typed so far.
     *
     * Ranked, because the order is the whole usefulness of a menu showing eight
     * of four hundred: an exact name first, then names that start with the
     * term, then names that merely contain it. Without that, `:fire` offers
     * `fire_engine` above the flame, which is how people stop using a feature
     * rather than report it.
     */
    fun search(term: String, limit: Int = SUGGESTION_LIMIT): List<Named> {
        val needle = term.trim().trimStart(':').lowercase()
        if (needle.isEmpty()) return emptyList()

        return ALL
            .mapNotNull { entry ->
                val rank = entry.names.minOfOrNull { name ->
                    when {
                        name == needle -> 0
                        name.startsWith(needle) -> 1
                        name.contains(needle) -> 2
                        else -> Int.MAX_VALUE
                    }
                } ?: Int.MAX_VALUE
                if (rank == Int.MAX_VALUE) null else entry to rank
            }
            // A stable sort keeps the table's own order inside each rank, which
            // is roughly most-common-first because that is how it was written.
            .sortedBy { it.second }
            .take(limit)
            .map { it.first }
    }

    data class Query(val term: String, val start: Int)

    private fun shortcodeChar(c: Char): Boolean =
        c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '_' || c == '+' || c == '-'

    /**
     * The `:term` being typed at the caret, if there is one.
     *
     * Where it starts as well as the term, because replacing it needs both.
     * Null for everything that is not one, and the exclusions are the whole of
     * the work: a colon in `https://` or in `10:30` must not open a menu, and a
     * colon already closed - `:tada:` - is a finished shortcode rather than a
     * search in progress.
     */
    fun queryAt(text: String, caret: Int): Query? {
        if (caret < 0 || caret > text.length) return null
        val before = text.substring(0, caret)
        val colon = before.lastIndexOf(':')
        if (colon == -1) return null

        val term = before.substring(colon + 1)
        // Two characters before anything is offered - a lone `:` would show a
        // menu over every URL somebody types.
        if (term.length < 2) return null
        if (!term.all(::shortcodeChar)) return null

        // What precedes the colon decides whether it is a shortcode at all.
        // Start of line or after whitespace is one; `https:` and `10:` are not.
        if (colon > 0 && !before[colon - 1].isWhitespace()) return null

        return Query(term, colon)
    }
}
