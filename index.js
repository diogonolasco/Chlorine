require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, ActivityType, Events, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const playdl = require('play-dl');
const ffmpegPath = require('ffmpeg-static');
const {
    handlePlay, playNextSong, handleAutoplay, handleStop,
    handleSkip, handleLeave, handleQueue, handleAjuda, handleClear, replyError
} = require('./comandos.js');

// Configura o FFmpeg no PATH
if (ffmpegPath) {
    const ffmpegDir = path.dirname(ffmpegPath);
    process.env.PATH = process.platform === 'win32' ? `${ffmpegDir};${process.env.PATH}` : `${ffmpegDir}:${process.env.PATH}`;
    console.log(`[Sistema] FFmpeg detectado e injetado no PATH.`);
}

// Inicializa SoundCloud
(async () => {
    try {
        const id = await playdl.getFreeClientID();
        await playdl.setToken({ soundcloud: { client_id: id } });
        console.log('Token de acesso do SoundCloud gerado com sucesso!');
    } catch (e) { console.error('Erro ao gerar token do SC:', e); }
})();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const THEME_COLOR = '#00e5ff';
const PREFIX = '!';
const musicQueues = new Map();

client.once(Events.ClientReady, () => {
    console.log(`Bot online como ${client.user.tag}!`);

    // Status Dinâmico
    const statuses = [
        { name: '🎵 !ajuda para começar', type: ActivityType.Listening },
        { name: '🔥 Som de Alta Qualidade', type: ActivityType.Playing },
        { name: `🎧 em ${client.guilds.cache.size} servidores`, type: ActivityType.Watching },
        { name: '✨ Chlorine Music™ Premium', type: ActivityType.Competing }
    ];

    let i = 0;
    const updateStatus = () => {
        client.user.setPresence({
            activities: [statuses[i]],
            status: 'online'
        });
        i = (i + 1) % statuses.length;
    };

    updateStatus(); // Chamada inicial imediata
    setInterval(updateStatus, 10000); // Rotaciona a cada 10s

    // SISTEMA DE REINÍCIO AUTOMÁTICO (Cada 1 hora)
    const RESTART_INTERVAL = 60 * 60 * 1000; // 1 hora
    const WARNING_TIME = 10 * 60 * 1000; // 10 minutos antes

    const scheduleRestart = () => {
        // Agenda o aviso de 10 minutos
        setTimeout(() => {
            musicQueues.forEach(queue => {
                if (queue.textChannel) {
                    const warningEmbed = new EmbedBuilder()
                        .setColor('#ffaa00')
                        .setTitle('🛠️ Manutenção Programada')
                        .setDescription('O bot irá reiniciar em **10 minutos** para otimização de sistema e limpeza de cache.\nA música pode ser interrompida brevemente.')
                        .setFooter({ text: 'Chlorine Music™ • Estabilidade' });
                    queue.textChannel.send({ embeds: [warningEmbed] }).catch(() => { });
                }
            });

            // Agenda o reinício real 10 minutos depois do aviso
            setTimeout(() => {
                musicQueues.forEach(queue => {
                    if (queue.textChannel) {
                        queue.textChannel.send({ embeds: [new EmbedBuilder().setColor('#ff3333').setDescription('🔄 **Reiniciando sistemas agora... Voltamos em instantes!**')] }).catch(() => { });
                    }
                });
                console.log('[Sistema] Reiniciando bot para manutenção programada...');
                setTimeout(() => process.exit(0), 3000);
            }, WARNING_TIME);

        }, RESTART_INTERVAL - WARNING_TIME);
    };

    scheduleRestart();
});

// Listener de Interações (Botões)
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.guildId) return;

    const guildId = interaction.guildId;
    const queue = musicQueues.get(guildId);

    const replyFn = (data) => interaction.reply({ ...data, flags: MessageFlags.Ephemeral }).catch(() => { });

    if (interaction.customId === 'btn_pause') {
        if (!queue) return replyError(replyFn, 'Nada tocando agora!');
        if (queue.player.state.status === 'paused') {
            queue.player.unpause();
            return interaction.reply({ content: '▶️ Música retomada!', flags: MessageFlags.Ephemeral });
        } else {
            queue.player.pause();
            return interaction.reply({ content: '⏸️ Música pausada!', flags: MessageFlags.Ephemeral });
        }
    }

    if (interaction.customId === 'btn_skip') {
        return handleSkip(replyFn, guildId, musicQueues, client, THEME_COLOR);
    }

    if (interaction.customId === 'btn_stop') {
        return handleStop(replyFn, guildId, musicQueues, client, THEME_COLOR);
    }

    if (interaction.customId === 'btn_shuffle') {
        if (!queue) return replyError(replyFn, 'Nada tocando agora!');
        const current = queue.songs.shift();
        for (let i = queue.songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
        }
        queue.songs.unshift(current);
        return interaction.reply({ content: '🔀 Fila embaralhada!', flags: MessageFlags.Ephemeral });
    }
});

client.on('error', (error) => { console.error('[Discord Client Error]', error); });

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const replyFn = async (data) => {
        try {
            return await message.reply(data);
        } catch (e) {
            return await message.channel.send(data).catch(() => { });
        }
    };

    if (message.mentions.has(client.user) && !message.mentions.everyone) {
        const banner = new AttachmentBuilder(path.join(__dirname, 'banner.png'), { name: 'banner.png' });
        const mentionEmbed = new EmbedBuilder()
            .setColor(THEME_COLOR)
            .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL() })
            .setTitle('👋 Olá! Eu sou o Chlorine Music™')
            .setDescription(`Estou aqui para transformar sua experiência musical no Discord com áudio de alta fidelidade.\n\nMeu prefixo neste servidor é: **\`${PREFIX}\`**`)
            .addFields(
                { name: '👑 Criador', value: '`.nolasco7`', inline: true },
                { name: '🌍 Servidores', value: `\`${client.guilds.cache.size}\``, inline: true },
                { name: '📡 Streaming', value: '`SoundCloud` & `YouTube`', inline: true }
            )
            .setThumbnail(client.user.displayAvatarURL({ size: 1024 }))
            .setImage('attachment://banner.png')
            .setFooter({ text: 'Use !ajuda para ver todos os comandos' });
        return message.reply({ embeds: [mentionEmbed], files: [banner] });
    }

    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'ajuda' || command === 'h') return handleAjuda(replyFn, PREFIX, message.author.displayAvatarURL(), client, THEME_COLOR);
    if (command === 'play' || command === 'p') {
        let query = args.join(' ');
        if (!query) return replyError(replyFn, 'Digite o nome da música ou o link da playlist!');
        return handlePlay(replyFn, message.member, query.replace(/^<+|>+$/g, ''), musicQueues, THEME_COLOR, client, playNextSong, handleAutoplay);
    }
    if (command === 'stop' || command === 'st') return handleStop(replyFn, message.guild.id, musicQueues, client);
    if (command === 'skip' || command === 's') return handleSkip(replyFn, message.guild.id, musicQueues, client, THEME_COLOR);
    if (command === 'leave' || command === 'l') return handleLeave(replyFn, message.guild.id, musicQueues, client, THEME_COLOR);
    if (command === 'queue' || command === 'q') return handleQueue(replyFn, message.guild.id, musicQueues, client, THEME_COLOR, (s) => s);
    if (command === 'apagarmensagem' || command === 'c' || command === 'am') return handleClear(replyFn, message, args, THEME_COLOR);
    if (command === 'ping') return replyFn({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setDescription(`📡 Latência: \`${Math.round(client.ws.ping)}ms\``)] });

    const queue = musicQueues.get(message.guild.id);
    if (command === 'pause') {
        if (!queue) return replyError(replyFn, 'Nada tocando!');
        queue.player.pause();
        return replyFn({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setDescription('⏸️ **Música pausada!**')] });
    }
    if (command === 'resume') {
        if (!queue) return replyError(replyFn, 'Nada tocando!');
        queue.player.unpause();
        return replyFn({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setDescription('▶️ **Música retomada!**')] });
    }
    if (command === 'nowplaying' || command === 'np') {
        if (!queue || queue.songs.length === 0) return replyError(replyFn, 'Nada tocando agora!');
        const song = queue.songs[0];
        const artist = song.publisher?.name || song.user?.username || song.channel?.name || 'Desconhecido';
        const npEmbed = new EmbedBuilder()
            .setColor(THEME_COLOR)
            .setAuthor({ name: '🎶 TOCANDO AGORA', iconURL: client.user.displayAvatarURL() })
            .setTitle(song.name || song.title)
            .setURL(song.permalink || song.url)
            .setThumbnail(song.thumbnail || (song.thumbnails ? song.thumbnails[0].url : null))
            .setDescription(`>>> **Artista:** \`${artist}\`\n**Fila:** \`${queue.songs.length}\` músicas`)
            .setFooter({ text: ` Chlorine Music Premium` });
        return replyFn({ embeds: [npEmbed] });
    }
    if (command === 'shuffle' || command === 'sh') {
        if (!queue || queue.songs.length < 2) return replyError(replyFn, 'Fila muito curta para embaralhar!');
        const current = queue.songs.shift();
        for (let i = queue.songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
        }
        queue.songs.unshift(current);
        return replyFn({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setDescription('🔀 **Fila embaralhada com sucesso!**')] });
    }
    if (command === 'autoplay' || command === 'ap') {
        if (!queue) return replyError(replyFn, 'Nada tocando agora!');
        queue.autoplay = !queue.autoplay;
        queue.textChannel = message.channel;
        return replyFn({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setDescription(`${queue.autoplay ? '✅' : '❌'} **Autoplay ${queue.autoplay ? 'ativado' : 'desativado'}!**`)] });
    }
    if (command === 'loop' || command === 'lp') {
        if (!queue) return replyError(replyFn, 'Nada tocando agora!');
        const modo = args[0]?.toLowerCase();
        if (!['off', 'song', 'queue'].includes(modo)) return replyError(replyFn, 'Use: `!loop off | song | queue`');
        queue.loop = modo;
        return replyFn({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setDescription(`🔁 **Modo de repetição alterado para:** \`${modo}\``)] });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        const queue = musicQueues.get(interaction.guild?.id);
        if (!queue) return interaction.reply({ content: '❌ Nenhuma música tocando agora.', flags: MessageFlags.Ephemeral });

        if (interaction.customId === 'btn_pause') {
            if (queue.player._state.status === 'paused') {
                queue.player.unpause();
                return interaction.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setDescription('▶️ **A música foi retomada!**')], flags: MessageFlags.Ephemeral });
            } else {
                queue.player.pause();
                return interaction.reply({ embeds: [new EmbedBuilder().setColor('#ffaa00').setDescription('⏸️ **A música foi pausada!**')], flags: MessageFlags.Ephemeral });
            }
        }
        if (interaction.customId === 'btn_skip') {
            handleSkip((d) => interaction.reply({ ...d, flags: MessageFlags.Ephemeral }), interaction.guild.id, musicQueues, client, THEME_COLOR);
            return;
        }
        if (interaction.customId === 'btn_shuffle') {
            if (queue.songs.length < 2) return interaction.reply({ content: '❌ Fila insuficiente para embaralhar.', flags: MessageFlags.Ephemeral });
            const current = queue.songs.shift();
            for (let i = queue.songs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
            }
            queue.songs.unshift(current);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setDescription('🔀 **A fila foi embaralhada com sucesso!**')], flags: MessageFlags.Ephemeral });
        }
        if (interaction.customId === 'btn_stop') {
            queue.songs = [];
            queue.player.stop();
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#ff3333').setAuthor({ name: '🛑 SESSÃO ENCERRADA', iconURL: client.user.displayAvatarURL() }).setTitle('A música foi parada').setDescription('A fila foi totalmente limpa.').setTimestamp()], flags: MessageFlags.Ephemeral });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_queue_jump') {
        const queue = musicQueues.get(interaction.guild?.id);
        if (!queue || queue.songs.length === 0) return interaction.reply({ content: '❌ Fila vazia.', flags: MessageFlags.Ephemeral });
        const index = parseInt(interaction.values[0]);
        if (index > 1) queue.songs.splice(1, index - 1);
        const nextSong = queue.songs[1];
        queue.player.stop();
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(THEME_COLOR).setAuthor({ name: '🚀 PULO RÁPIDO', iconURL: client.user.displayAvatarURL() }).setDescription(`Saltando diretamente para:\n**${nextSong.name || nextSong.title}**`)], flags: MessageFlags.Ephemeral });
    }
});

client.login(process.env.DISCORD_TOKEN);
