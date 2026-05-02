const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, NoSubscriberBehavior } = require('discord-voip');
const playdl = require('play-dl');
const path = require('path');

function formatDuration(seconds) {
    if (!seconds) return 'Ao vivo';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function handlePlay(replyFn, member, query, musicQueues, THEME_COLOR, client, playNextSong, handleAutoplay) {
    if (!member.voice.channel) return replyError(replyFn, 'Você precisa estar em um canal de voz para tocar música!');

    try {
        console.log(`[Busca] Procurando por: ${query}`);
        let searchResults = [];
        let isPlaylist = false;
        let playlistInfo = null;

        async function fetchAudio() {
            const type = await playdl.validate(query);
            
            // Se for link direto, respeita a escolha
            if (type && (type.includes('so_') || type.includes('yt_'))) {
                if (type === 'so_playlist') {
                    isPlaylist = true;
                    playlistInfo = await playdl.soundcloud(query);
                    return await playlistInfo.all_tracks();
                }
                if (type === 'yt_playlist') {
                    isPlaylist = true;
                    const playlist = await playdl.playlist_info(query);
                    return await playlist.all_videos();
                }
                const info = type.includes('so_') ? await playdl.soundcloud(query) : await playdl.video_info(query);
                return [type.includes('so_') ? info : info.video_details];
            }

            // BUSCA INTELIGENTE NO SOUNDCLOUD (Focada em Versões Completas)
            console.log('[Busca] Buscando versão completa no SoundCloud...');
            // Procuramos por "Nome + Full" para evitar a prévia de 30s das contas oficiais
            const search = await playdl.search(`${query} full version`, { limit: 5, source: { soundcloud: 'tracks' } });
            
            // Filtramos para pegar a primeira música que tenha mais de 60 segundos (ignora as prévias de 30s)
            const fullVersion = search.find(t => (t.durationInSec || 0) > 60);
            
            if (fullVersion) {
                console.log(`[Busca] Sucesso! Encontrada versão completa: ${fullVersion.name} (${fullVersion.durationInSec}s)`);
                return [fullVersion];
            }

            // Se não achou no SC, tenta YouTube como último recurso
            console.log('[Busca] Versão completa não achada no SC, tentando YouTube...');
            return await playdl.search(query, { limit: 1, source: { youtube: 'video' } });
        }

        try {
            searchResults = await fetchAudio();
        } catch (apiError) {
            console.log('[Erro na Busca]', apiError.message);
            searchResults = await playdl.search(query, { limit: 1, source: { soundcloud: 'tracks' } });
        }

        if (!searchResults || searchResults.length === 0) {
            return replyFn({ embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('❌ Nenhuma música ou playlist encontrada.')] });
        }

        let queue = musicQueues.get(member.guild.id);

        if (!queue) {
            const player = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play
                }
            });
            const connection = joinVoiceChannel({
                channelId: member.voice.channel.id,
                guildId: member.guild.id,
                adapterCreator: member.guild.voiceAdapterCreator,
                selfDeaf: false
            });

            queue = {
                connection,
                player,
                songs: [],
                loop: 'off',
                autoplay: false,
                lastSong: null,
                history: [],
                consecutiveErrors: 0,
                textChannel: member.guild.channels.cache.get(member.voice.channel.id) || null
            };

            musicQueues.set(member.guild.id, queue);
            connection.subscribe(player);

            connection.on('stateChange', async (oldState, newState) => {
                if (newState.status === VoiceConnectionStatus.Disconnected) {
                    try {
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                            entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                        ]);
                    } catch (e) {
                        console.log('[Voice] Falha na reconexão automática.');
                    }
                } else if (newState.status === VoiceConnectionStatus.Destroyed) {
                    musicQueues.delete(member.guild.id);
                }
            });

            player.on(AudioPlayerStatus.Idle, async () => {
                const guildId = member.guild.id;
                const queue = musicQueues.get(guildId);
                if (!queue) return;

                if (queue.loop === 'song') {
                    playNextSong(guildId, musicQueues, THEME_COLOR);
                } else if (queue.loop === 'queue') {
                    const lastSong = queue.songs.shift();
                    queue.lastSong = lastSong;
                    if (lastSong) {
                        queue.history.push(lastSong.url || lastSong.permalink);
                        if (queue.history.length > 10) queue.history.shift();
                    }
                    queue.songs.push(lastSong);
                    playNextSong(guildId, musicQueues, THEME_COLOR);
                } else {
                    const finishedSong = queue.songs.shift();
                    if (finishedSong) {
                        queue.lastSong = finishedSong;
                        queue.history.push(finishedSong.url || finishedSong.permalink);
                        if (queue.history.length > 10) queue.history.shift();
                    }

                    if (queue.songs.length > 0) {
                        playNextSong(guildId, musicQueues, THEME_COLOR);
                    } else if (queue.autoplay) {
                        handleAutoplay(guildId, musicQueues, THEME_COLOR, client, playNextSong);
                    } else {
                        // Inicia cronômetro de auto-saída (15 segundos)
                        if (queue.idleTimer) clearTimeout(queue.idleTimer);
                        queue.idleTimer = setTimeout(() => {
                            const q = musicQueues.get(guildId);
                            if (q && q.songs.length === 0) {
                                handleLeave(() => { }, guildId, musicQueues, client, THEME_COLOR);
                                if (q.textChannel) {
                                    q.textChannel.send({
                                        embeds: [new EmbedBuilder()
                                            .setColor('#ff3333')
                                            .setAuthor({ name: '🚪 SESSÃO ENCERRADA', iconURL: client.user.displayAvatarURL() })
                                            .setDescription('A fila acabou. Saí do canal por inatividade. Até a próxima!')
                                        ]
                                    }).catch(() => { });
                                }
                            }
                        }, 15000);
                    }
                }
            });

            player.on('error', (error) => {
                player.stop();
                player.emit(AudioPlayerStatus.Idle);
            });
        }

        const wasEmpty = queue.songs.length === 0;
        for (const track of searchResults) {
            queue.songs.push(track);
        }

        if (isPlaylist) {
            const cover = playlistInfo.thumbnail || (searchResults[0]?.thumbnail || null);
            const playEmbed = new EmbedBuilder()
                .setColor(THEME_COLOR)
                .setTitle(`📂 Playlist Adicionada: ${playlistInfo.name || playlistInfo.title}`)
                .setURL(playlistInfo.url || playlistInfo.permalink || query)
                .setThumbnail(cover)
                .setDescription(`>>> Foram adicionadas **${searchResults.length}** músicas à fila.`)
                .addFields(
                    { name: '👤 Solicitado por', value: `${member}`, inline: true },
                    { name: '🔢 Fila', value: `\`${queue.songs.length}\` músicas`, inline: true }
                )
                .setFooter({ text: 'Use !queue para ver a lista completa' })
                .setTimestamp();

            await replyFn({ embeds: [playEmbed] });
        } else {
            const song = searchResults[0];
            const songThumbnail = song.thumbnail || (song.thumbnails ? song.thumbnails[0].url : null);
            const authorText = wasEmpty ? '🎶 Iniciando Reprodução' : '🎵 Adicionado à Fila';
            
            const duration = song.durationRaw || formatDuration(song.durationInSec);
            const artist = song.publisher?.name || song.user?.username || song.channel?.name || 'Desconhecido';

            const playEmbed = new EmbedBuilder()
                .setColor(THEME_COLOR)
                .setAuthor({ name: authorText, iconURL: client.user.displayAvatarURL() })
                .setTitle(song.name || song.title)
                .setURL(song.permalink || song.url)
                .setThumbnail(songThumbnail)
                .setDescription(`>>> **Duração:** \`${duration}\`\n**Artista:** \`${artist}\``)
                .addFields(
                    { name: '👤 Pedido por', value: `${member}`, inline: true },
                    { name: '🔢 Posição', value: wasEmpty ? '`Tocando agora`' : `\`#${queue.songs.length}\``, inline: true }
                )
                .setFooter({ text: ` Chlorine Music • Premium Audio`, iconURL: member.user.displayAvatarURL() });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_pause').setLabel('Pausar/Tocar').setEmoji('⏯️').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_skip').setLabel('Pular').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_stop').setLabel('Parar').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('btn_shuffle').setLabel('Embaralhar').setEmoji('🔀').setStyle(ButtonStyle.Secondary)
            );

            await replyFn({ embeds: [playEmbed], components: [row] });
        }

        if (wasEmpty) {
            playNextSong(member.guild.id, musicQueues, THEME_COLOR);
        }

    } catch (e) {
        console.error('Erro no Play:', e);
        return replyFn({ content: `❌ Ocorreu um erro ao processar a música: \`${e.message}\`` });
    }
}

async function playNextSong(guildId, musicQueues, THEME_COLOR) {
    const queue = musicQueues.get(guildId);
    if (!queue || queue.songs.length === 0) return;
    const song = queue.songs[0];

    try {
        if (queue.connection.state.status !== VoiceConnectionStatus.Ready) {
            await entersState(queue.connection, VoiceConnectionStatus.Ready, 10000);
        }

        let urlToStream = String(song.url || song.permalink).trim();
        console.log(`[Stream] Preparando: ${urlToStream}`);
        
        let stream;
        try {
            // Tentativa com Modo de Compatibilidade e BUFFER OTIMIZADO
            stream = await playdl.stream(urlToStream, { 
                discordPlayerCompatibility: true,
                quality: 2, // Garante alta qualidade estável
                highWaterMark: 1 << 25 // Buffer de 32MB para evitar lag
            });
        } catch (e) {
            console.log(`[Stream] Falha no modo compatibilidade: ${e.message}. Tentando extração profunda...`);
            try {
                const info = await playdl.video_info(urlToStream);
                stream = await playdl.stream(info.video_details.url, { 
                    discordPlayerCompatibility: true,
                    highWaterMark: 1 << 25
                });
            } catch (e2) {
                console.log(`[Stream] Falha total no YouTube. Buscando alternativa no SoundCloud...`);
                const search = await playdl.search(`${song.name || song.title} full version`, { limit: 1, source: { soundcloud: 'tracks' } });
                if (search.length > 0) {
                    stream = await playdl.stream(search[0].url, { highWaterMark: 1 << 25 });
                } else {
                    throw new Error('Não foi possível gerar áudio de nenhuma fonte.');
                }
            }
        }

        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true,
            sampleRate: 48000
        });

        resource.playStream.on('end', async () => {
            // Fallback SoundCloud Go+ se necessário (simplificado aqui para o comandos.js)
        });

        queue.player.play(resource);
        queue.consecutiveErrors = 0;

        // Limpa cronômetro de auto-saída se a música começou
        if (queue.idleTimer) {
            clearTimeout(queue.idleTimer);
            queue.idleTimer = null;
        }
    } catch (e) {
        console.error('Erro ao gerar stream:', e.message);
        queue.consecutiveErrors = (queue.consecutiveErrors || 0) + 1;

        if (queue.consecutiveErrors > 3) {
            musicQueues.delete(guildId);
            return;
        }

        queue.songs.shift();
        playNextSong(guildId, musicQueues, THEME_COLOR);
    }
}

async function handleAutoplay(guildId, musicQueues, THEME_COLOR, client, playNextSong) {
    const queue = musicQueues.get(guildId);
    if (!queue || queue.songs.length > 0) return;

    try {
        let searchTerm = 'lofi hip hop';
        if (queue.lastSong) {
            const words = (queue.lastSong.name || queue.lastSong.title || '').split(' ').slice(0, 3).join(' ').replace(/[^\w\s]/gi, ' ').trim();
            if (words) searchTerm = words;
        }

        const search = await playdl.search(searchTerm, { limit: 10, source: { soundcloud: 'tracks' } });
        const filtered = search.filter(track => !queue.history.includes(track.url || track.permalink));

        if (filtered.length > 0) {
            const nextTrack = filtered[Math.floor(Math.random() * Math.min(filtered.length, 5))];
            queue.songs.push(nextTrack);

            if (queue.textChannel) {
                const autoEmbed = new EmbedBuilder()
                    .setColor(THEME_COLOR)
                    .setAuthor({ name: '✨ Sintonizando Próxima Faixa', iconURL: client.user.displayAvatarURL() })
                    .setTitle(nextTrack.name || nextTrack.title)
                    .setURL(nextTrack.permalink || nextTrack.url)
                    .setDescription(`>>> *Autoplay:* Recomendação baseada na sua última música!`)
                    .setFooter({ text: 'Chlorine Music™ • Música Infinita' });
                queue.textChannel.send({ embeds: [autoEmbed] }).catch(() => { });
            }
            playNextSong(guildId, musicQueues, THEME_COLOR);
        }
    } catch (e) {
        console.error(`[Autoplay] Erro crítico:`, e.message);
    }
}

async function handleStop(replyFn, guildId, musicQueues, client, THEME_COLOR) {
    const queue = musicQueues.get(guildId);
    if (!queue) return replyError(replyFn, 'Não há nada tocando!');
    
    queue.songs = [];
    queue.player.stop();
    
    // Inicia cronômetro de auto-saída (15 segundos)
    if (queue.idleTimer) clearTimeout(queue.idleTimer);
    queue.idleTimer = setTimeout(() => {
        const q = musicQueues.get(guildId);
        if (q && q.songs.length === 0) {
            handleLeave(() => { }, guildId, musicQueues, client, THEME_COLOR);
            if (q.textChannel) {
                q.textChannel.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff3333')
                        .setAuthor({ name: '🚪 SESSÃO ENCERRADA', iconURL: client.user.displayAvatarURL() })
                        .setDescription('Saí do canal de voz porque a fila estava vazia por muito tempo.')
                    ]
                }).catch(() => { });
            }
        }
    }, 15000);

    return replyFn({ embeds: [new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setAuthor({ name: '⏹️ SESSÃO ENCERRADA', iconURL: client.user.displayAvatarURL() })
        .setDescription('**A música parou e a fila foi limpa!**')
    ] });
}

async function handleSkip(replyFn, guildId, musicQueues, client, THEME_COLOR) {
    const queue = musicQueues.get(guildId);
    if (!queue || queue.songs.length === 0) return replyFn({ embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('❌ Não há música para pular!')] });

    const skipEmbed = new EmbedBuilder().setColor(THEME_COLOR);
    if (queue.songs.length > 1) {
        const nextSong = queue.songs[1];
        const nextThumbnail = nextSong.thumbnail || (nextSong.thumbnails ? nextSong.thumbnails[0].url : null);
        skipEmbed.setAuthor({ name: '⏭️ FAIXA PULADA', iconURL: client.user.displayAvatarURL() })
            .setTitle(nextSong.name || nextSong.title)
            .setURL(nextSong.permalink || nextSong.url)
            .setDescription('✨ **Tocando em seguida** ✨')
            .setImage(nextThumbnail)
            .setFooter({ text: 'A festa não para!' })
            .setTimestamp();
    } else {
        skipEmbed.setAuthor({ name: '⏭️ FAIXA PULADA', iconURL: client.user.displayAvatarURL() })
            .setTitle('Fim da linha!')
            .setDescription('⏹️ **A fila de músicas acabou.**')
            .setFooter({ text: 'Adicione mais músicas para continuar.' })
            .setTimestamp();
    }

    queue.player.stop();
    await replyFn({ embeds: [skipEmbed] });
}

async function handleLeave(replyFn, guildId, musicQueues, client, THEME_COLOR) {
    const queue = musicQueues.get(guildId);
    if (!queue) return replyFn({ embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('❌ Não estou conectado em nenhum canal de voz!')] });
    queue.songs = [];
    queue.player.stop();
    queue.connection.destroy();
    musicQueues.delete(guildId);
    await replyFn({
        embeds: [
            new EmbedBuilder()
                .setColor(THEME_COLOR)
                .setAuthor({ name: '👋 FUI!', iconURL: client.user.displayAvatarURL() })
                .setTitle('Desconectado com sucesso')
                .setDescription('Foi bom enquanto durou. Até a próxima sessão!')
                .setTimestamp()
        ]
    });
}

async function handleQueue(replyFn, guildId, musicQueues, client, THEME_COLOR, formatDuration) {
    const queue = musicQueues.get(guildId);
    if (!queue || queue.songs.length === 0) {
        return replyFn({ embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('❌ A fila está vazia!')] });
    }

    const currentSong = queue.songs[0];
    const upcoming = queue.songs.slice(1, 11);

    let description = `**▶️ Tocando Agora:**\n[${currentSong.name || currentSong.title}](${currentSong.permalink || currentSong.url})\n\n`;

    if (upcoming.length > 0) {
        description += `**📂 Próximas Faixas:**\n`;
        upcoming.forEach((song, i) => {
            const dur = song.durationRaw || formatDuration(song.durationInSec) || '??';
            description += `\`${i + 1}.\` [${song.name || song.title}](${song.permalink || song.url}) | \`${dur}\`\n`;
        });
        if (queue.songs.length > 11) {
            description += `\n*... e mais ${queue.songs.length - 11} músicas.*`;
        }
    } else {
        description += `*Nenhuma música na fila. Use !play para adicionar!*`;
    }

    const embed = new EmbedBuilder()
        .setAuthor({ name: '🎼 Fila de Reprodução', iconURL: client.user.displayAvatarURL() })
        .setDescription(description)
        .setColor(THEME_COLOR)
        .addFields(
            { name: '⚙️ Configurações', value: `Loop: \`${queue.loop}\` | Autoplay: \`${queue.autoplay ? 'Ativado' : 'Desativado'}\``, inline: false }
        )
        .setFooter({ text: `Total de músicas: ${queue.songs.length} | Chlorine Music`, iconURL: client.user.displayAvatarURL() });

    const components = [];
    if (queue.songs.length > 1) {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_queue_jump')
            .setPlaceholder('🚀 Pular diretamente para uma música')
            .addOptions(
                queue.songs.slice(1, 21).map((song, i) => ({
                    label: (song.name || song.title).substring(0, 100),
                    description: `Duração: ${song.durationRaw || 'Desconhecida'}`,
                    value: (i + 1).toString(),
                    emoji: '🎵'
                }))
            );
        components.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    await replyFn({ embeds: [embed], components });
}

async function handleAjuda(replyFn, prefix, userAvatar, client, THEME_COLOR) {
    const helpEmbed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setAuthor({ name: 'Central de Comandos', iconURL: client.user.displayAvatarURL() })
        .setTitle('🎵 Chlorine Music - Guia de Utilização')
        .setDescription(`>>> Utilize os comandos abaixo usando o prefixo **\`${prefix}\`** ou suas abreviações.`)
        .addFields(
            {
                name: '🎼 Reprodução', value:
                    `\`${prefix}play\` (**${prefix}p**) - Toca música.\n` +
                    `\`${prefix}pause\` - Pausa o som.\n` +
                    `\`${prefix}resume\` - Retoma o som.\n` +
                    `\`${prefix}skip\` (**${prefix}s**) - Pula a música.\n` +
                    `\`${prefix}stop\` (**${prefix}st**) - Para tudo.`, inline: false
            },
            {
                name: '📂 Gerenciamento', value:
                    `\`${prefix}queue\` (**${prefix}q**) - Mostra a fila.\n` +
                    `\`${prefix}nowplaying\` (**${prefix}np**) - Música atual.\n` +
                    `\`${prefix}shuffle\` (**${prefix}sh**) - Mistura a fila.\n` +
                    `\`${prefix}loop\` (**${prefix}lp**) - Repetição.`, inline: false
            },
            {
                name: '✨ Recursos Premium', value:
                    `\`${prefix}autoplay\` (**${prefix}ap**) - Rádio automática.\n` +
                    `\`${prefix}leave\` (**${prefix}l**) - Sai do canal.`, inline: false
            },
            {
                name: '🤖 Outros', value:
                    `\`${prefix}ping\` - Latência.\n` +
                    `\`${prefix}apagarmensagem\` (**${prefix}c** / **${prefix}am**) - Limpa o chat (1-1000).\n` +
                    `\`${prefix}ajuda\` (**${prefix}h**) - Este menu.`, inline: false
            }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: 'Explosão Sonora • Chlorine Music™', iconURL: userAvatar });
    await replyFn({ embeds: [helpEmbed] });
}

async function handleClear(replyFn, message, args, THEME_COLOR) {
    if (!message.member.permissions.has('ManageMessages')) {
        return replyError(replyFn, 'Você não tem permissão para gerenciar mensagens!');
    }
    
    let amount = parseInt(args[0]);
    if (isNaN(amount) || amount < 1 || amount > 1000) {
        return replyError(replyFn, 'Informe uma quantidade entre 1 e 1000 mensagens para apagar.');
    }

    try {
        let deletedTotal = 0;
        
        // Loop para apagar em lotes de 100 (limite do Discord)
        while (amount > 0) {
            const batchSize = Math.min(amount, 100);
            const deleted = await message.channel.bulkDelete(batchSize, true);
            if (deleted.size === 0) break; // Não há mais mensagens para apagar (ou são > 14 dias)
            deletedTotal += deleted.size;
            amount -= batchSize;
            
            // Pequena pausa para evitar rate limit se for uma limpeza muito grande
            if (amount > 0) await new Promise(r => setTimeout(r, 1000));
        }

        const successEmbed = new EmbedBuilder()
            .setColor(THEME_COLOR)
            .setDescription(`✅ **Limpamos ${deletedTotal} mensagens com sucesso!**`)
            .setFooter({ text: 'Limpeza concluída' });
        
        const feedbackMsg = await message.channel.send({ embeds: [successEmbed] });
        setTimeout(() => feedbackMsg.delete().catch(() => {}), 5000);
    } catch (e) {
        console.error('Erro ao limpar mensagens:', e);
        return replyError(replyFn, 'Ocorreu um erro ao tentar apagar as mensagens. Lembre-se: mensagens com mais de 14 dias não podem ser apagadas em massa.');
    }
}

function replyError(replyFn, text) {
    return replyFn({ embeds: [new EmbedBuilder().setColor('#ff3333').setDescription(`❌ ${text}`)] });
}

module.exports = {
    handlePlay,
    playNextSong,
    handleAutoplay,
    handleStop,
    handleSkip,
    handleLeave,
    handleQueue,
    handleAjuda,
    handleClear,
    replyError
};
