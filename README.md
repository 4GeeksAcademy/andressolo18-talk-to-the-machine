# Talk to the Machine

Chat con React, Vite y un servidor Express para conectar con Groq.

## Estado

El campo de texto y el boton de envio llaman a `/api/chat` en Express, que
consulta Groq y devuelve la respuesta. Enter envia y Shift+Enter inserta una
linea nueva. Cada mensaje del usuario se agrega al estado antes de la peticion;
se envia todo el historial de usuarios e IA, incluido el nuevo mensaje.
Durante la solicitud se bloquean los envios simultaneos. Si falla, el mensaje
permanece en el historial y el boton de reintento lo reutiliza sin duplicarlo.

La barra lateral acumula el consumo real de `usage` de las respuestas recibidas
y muestra el modelo y el tiempo de respuesta. La sesion se carga al montar el
componente y se guarda despues de cada cambio en `localStorage`, incluyendo
mensajes y metricas. Sobrevive a recargas y al cierre de la pestaña en el mismo
navegador y origen. El borrador del campo de texto no se guarda.

El boton de borrar conversacion pide confirmacion y reinicia mensajes,
contadores y borrador, eliminando solo la clave de almacenamiento de este chat.
Esta desactivado mientras hay una solicitud en curso. Si se recarga antes de
recibir una respuesta, se conserva el mensaje del usuario sin reenviarlo
automaticamente; aparece un aviso y queda disponible el reintento manual.

Si el navegador bloquea `localStorage`, se llena el almacenamiento o los datos
guardados son invalidos, se muestra un aviso. En esos casos la persistencia no
esta garantizada. No se guardan claves de API ni se sincronizan dispositivos.

## Requisitos

- Node.js 22.12 o superior y npm.
- Una cuenta en [Groq](https://console.groq.com/) y una API key.

## Configuracion local

1. Instala las dependencias con `npm install`.
2. Copia la plantilla de entorno: `cp .env.example .env`.
3. Genera una clave en la consola de Groq y asignala a `GROQ_API_KEY` en `.env`.
4. Ejecuta `npm run dev` y abre la URL que muestra Vite (normalmente
	 `http://localhost:5173`).

La clave se usara exclusivamente en Express. No la compartas ni uses un nombre
con prefijo `VITE_`, que expondria su valor al navegador. `.env` esta excluido de Git.
El endpoint `/api/health` comprueba el servidor, no las credenciales de Groq.

Express escucha en el puerto `3001`. Puedes cambiar `PORT` en `.env` si esta
ocupado; reinicia ambos procesos despues de cambiarlo. Vite redirige `/api` a
ese puerto. Si el puerto web esta ocupado, Vite selecciona otro.

## Comandos

- `npm run dev`: inicia frontend y servidor con recarga durante desarrollo.
- `npm run build`: genera el frontend en `dist`.
- `npm start`: sirve la compilacion y la API desde Express, normalmente en
	`http://localhost:3001`. Ejecuta primero `npm run build`.

## Integracion con Groq

El modelo es exactamente `qwen/qwen3.8-27b`, sin sustitucion automatica.
Se mantiene Qwen por decision del usuario: el catalogo autenticado de Groq
consultado el 2026-11-07 no ofrece ningun Llama 3 de chat para esta cuenta.
Una llamada de prueba a Groq el 2026-11-07 respondio HTTP 200 con el texto `OK`
y un consumo de 17 tokens de prompt, 2 de completado y 19 totales.
Esta prueba confirma acceso al modelo, no las condiciones del plan gratuito.

Se muestran los tokens de prompt, completado y totales acumulados a partir de
`usage`, junto con el nombre del modelo y el tiempo de respuesta. Una solicitud
interrumpida antes de recibir `usage` puede generar consumo que no sea posible
contabilizar localmente. No se reintentan solicitudes automaticamente.

El servidor acepta hasta 100 mensajes, 20000 caracteres por mensaje y un cuerpo
JSON de 256 KB. Envia el contexto completo sin truncarlo; limita cada respuesta
a 2048 tokens de completado y espera como maximo 30 segundos a Groq.

Este proyecto esta destinado al uso local. Antes de publicarlo, se necesitan
controles de acceso y limites de uso para proteger la clave y la cuota.