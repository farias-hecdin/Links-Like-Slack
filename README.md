# Links Like Slack

Un plugin para [Obsidian](https://obsidian.md/) diseñado para mejorar la edición y visualización de enlaces Markdown.[^1]

[^1]: Este plugin ha sido diseñado con la ayuda de AI.

## Características principales

- **Generación de texto aleatorio:** Incluye un botón (icono de dados) en la modal de enlaces para generar un texto de enlace aleatorio (estilo `nanoid`) con longitud y alfabeto personalizables.
- **Ocultamiento visual de URLs:** Opción para mostrar las URLs largas como `https...` o `www...` directamente en el editor *—Esto es solo visual; el archivo Markdown subyacente no se modifica—*.
- **Revelar al colocar el cursor:** Si el ocultamiento de URLs está activo, puedes hacer que la URL completa se muestre temporalmente cuando el cursor o la selección se encuentra sobre el enlace.
- **Modal de edición intuitivo:** Detecta si estás sobre un enlace existente para editarlo, o te permite crear uno nuevo a partir del texto seleccionado.

## Instalación

1. Descarga la última versión del plugin (archivo `.zip` o `.tar.gz`) desde la sección de Releases.
2. Descomprime el archivo en la carpeta de plugins de tu bóveda de Obsidian:
   `TuBoveda/.obsidian/plugins/Links-Like-Slack/`
3. Abre Obsidian y ve a **Configuración > Plugins de la comunidad**.
4. Desactiva el **Modo Seguro** (Safe Mode) si está activado.
5. Busca **Links Like Slack** en la lista y haz clic en **Activar**.

## Configuración

El plugin añade una pestaña de configuración en **Configuración** > **Links Like Slack**, donde puedes ajustar:

| Opción | Descripción |
| :--- | :--- |
| **Longitud del nombre aleatorio** | Número de caracteres que generará el botón de dados (valor entre 3 y 36). |
| **Alfabeto** | Conjunto de caracteres permitidos para la generación aleatoria. Se eliminan automáticamente los espacios y duplicados. Debe tener al menos 2 caracteres. |
| **Ocultar URLs de los enlaces** | Activa el modo visual limpio. Los enlaces se verán como `[texto](https...)` en lugar de mostrar la dirección completa. |
| **Mostrar la URL al editar el enlace** | Si la opción anterior está activa, esta permite que la URL completa se reveale temporalmente cuando el cursor está dentro del enlace, facilitando su edición sin desactivar el ocultamiento. |

## Licencia

**Links Like Slack** está bajo la licencia MIT. Consulta el archivo `LICENSE` para obtener más información.

