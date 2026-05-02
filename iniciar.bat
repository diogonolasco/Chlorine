@echo off
title Chlorine Music(tm) - Ultra Stability Console
mode con: cols=90 lines=32
color 0b

:inicio
cls
echo.
echo   ########################################################################################
echo   #                                                                                      #
echo   #    ____ _   _ _      ___  ____  ___ _   _ _____    __  __ _   _ ____ ___ ____        #
echo   #   / ___^| ^| ^| ^| ^|    / _ \^|  _ \^|_ _^| \ ^| ^| ____^|  ^|  \/  ^| ^| ^| / ___^|_ _/ ___^|       #
echo   #  ^| ^|   ^| ^|_^| ^| ^|   ^| ^| ^| ^| ^|_) ^|^| ^|^|  \^| ^|  _^|    ^| ^|^\/^| ^| ^| \___ \ ^| ^| ^|           #
echo   #  ^| ^|___^|  _  ^| ^|___^| ^|_^| ^|  _ ^< ^| ^|^| ^|\  ^| ^|___   ^| ^|  ^| ^| ^|_^| ^|___) ^|^| ^| ^|___        #
echo   #   \____^|_^| ^|_^|_____^\___/^|_^| \_\___^|_^| \_^|_____^|  ^|_^|  ^|_^|^\___/^|____/___^\____^|       #
echo   #                                                                                      #
echo   #                        SISTEMA DE ESTABILIDADE E AUTO-RESTART                        #
echo   ########################################################################################
echo.
echo   [STATUS] %date% %time% - Iniciando nucleo de audio...
echo   [INFO]   Modo: Premium High Fidelity (48kHz)
echo   [INFO]   Manutencao: Programada a cada 1 hora
echo   [INFO]   Seguranca: Protecao contra crashes ativada
echo.
echo   ----------------------------------------------------------------------------------------
echo                             LOGS DE PROCESSAMENTO DO BOT
echo   ----------------------------------------------------------------------------------------
echo.

node index.js

echo.
echo   ----------------------------------------------------------------------------------------
echo   [ALERTA] O processo do bot foi encerrado ou reiniciado para limpeza de cache.
echo   [SISTEMA] Aplicando otimizacoes e reiniciando em 5 segundos...
echo   ----------------------------------------------------------------------------------------
echo.
timeout /t 5 > nul
goto inicio
