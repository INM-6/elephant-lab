import {
	ICommandPalette, IClientSession
} from '@jupyterlab/apputils';
import {
	Widget
} from '@phosphor/widgets';
import {
	INotebookTracker, NotebookActions
} from '@jupyterlab/notebook';
import {
	JupyterLab, JupyterLabPlugin
} from '@jupyterlab/application';
import {
	KernelMessage, Kernel
} from '@jupyterlab/services';

import * as CodeMirror from 'codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/mode/python/python';

import {
    WidgetManager
} from './manager';

//import * as d3 from 'd3';

import '../style/index.css';

/*

   		var load_css = function() {
			//$('#site').css({width: '70%'});
			console.log("HEEEERE");
        		var link = document.createElement("link");
        		link.type = "text/css";
        		link.rel = "stylesheet";
        		link.href = require.toUrl("/nbextensions/new_ext/new_main.css");
        		document.getElementsByTagName("head")[0].appendChild(link);
			console.log("HEREEEEEE");
			console.log(link);
			$("body").append('<div><div id="content" style="display:inline-block;width=30%;"><p>Text</p></div></div>');
			$.get("/nbextensions/new_ext/new_main.html", function (data) {$("#content").append(data);console.log("A "+ data);});
			//$('#content').load("./../nbextensions/new_ext/new_main.html", function( response, status, xhr ) {console.log(xhr.statusText + " " +response);});
    		};

		var showd3 = function(d3){
			console.log("D3 "+d3.version);
			var data = [150, 230, 180, 90];

			var svg = d3.select("#content")
            		.append("svg")
            		.attr("width", 300)
            		.attr("height", 200);
 			svg.selectAll(".bar")
				.data(data)
  				.enter()
  				.append("rect")
  				.attr({
    					class : "bar",
    					width : function(d) {return d;},
    					height: "40",
    					y : function(d, i) {return i*50 + 10;},
    					x : "10"
   				});
			console.log("D3 finished");
		};
		var updateplot = function(d3){
			//require.config({
			 // paths: {
			 //     d3: '//cdnjs.cloudflare.com/ajax/libs/d3/3.4.8/d3.min'
			 // }
			//});
			//require(["d3"], function(d3) {console.log("D3 loaded: "+d3.version);});
			console.log("D3 "+d3.version);
			var data = [10, 100, 190];

			var svg = d3.select("#content");
 			var bars = svg.selectAll(".bar")
				.data(data);
			//bars.attr("class", "update");
			// Remove unnecessary bars if data became less
  			bars.exit().remove();
			// Add new bars that might be needed additionally
			bars.enter()
  				.append("rect")
  				.attr({
    					class : "bar",
    					width : function(d) {return d;},
    					height: "40",
    					y : function(d, i) {return i*50 + 10;},
    					x : "10"
   				});
				//.merge(bars)
				//	.data(function(d){return d;});
			bars.transition()
				.duration(0)
				// Update all attributes
  				.attr({
    					class : "bar",
    					width : function(d) {return d;},
    					height: "40",
    					y : function(d, i) {return i*50 + 10;},
    					x : "10"
   				});
			console.log("D3 finished");
		};

		/*var updateplot = function(d3){
			var data = [10, 100, 10, 100];
			var svg = d3.select("#content").transition();
			svg.selectAll(".bar")
				.data(data)
				.enter();
		};*/


/**
 * Initialization data for the neo_elephant extension.
 */
const extension: JupyterLabPlugin<void> = {
	id: 'neo_elephant',
	autoStart: true,
	requires: [ICommandPalette, INotebookTracker],
	activate: 
	(app: JupyterLab, palette: ICommandPalette, consoles: INotebookTracker) => {
			
		console.log('JupyterLab extension neo_elephant is activated!');
		let widget: Widget = new Widget();
		widget.id = 'neo_elephant';
		widget.title.label = 'Visualization';
		widget.title.closable = true;
		let var_place = document.createElement('div');
		var_place.setAttribute("id", "neo_ele_vars");
		widget.node.appendChild(var_place);

		/*		// Setup for ipywidgets
		let jupyter_area = document.createElement('div');
		let input_area = document.createElement('div');
		let widget_area = document.createElement('div');
		input_area.setAttribute("class", "inputarea");
		widget_area.setAttribute("class", "widgetarea");
		jupyter_area.appendChild(input_area);
		jupyter_area.appendChild(widget_area);*/



		function ioCallback(msg: KernelMessage.IIOPubMessage): void {
			console.log("Got return from Kernel");
			console.log(msg);
			if(msg.header.msg_type == 'stream' && msg.content.name == 'stdout'){
				console.log("Stdout: ", msg.content);
				let text = document.createTextNode(msg.content.text as string);
				let old_text = var_place.childNodes[0];
				if(old_text != null){
					var_place.removeChild(old_text);
				}
				var_place.appendChild(text);
			}
		}

		consoles.widgetAdded.connect((sender, consolePanel) => {

			               if (!widget.isAttached) {
                                        app.shell.addToMainArea(widget);
                                }
                                app.shell.activateById(widget.id);

			
			var session: IClientSession = consolePanel.session;
			console.log("Session.ready: ", session.ready);

			session.ready.then(() => {session.kernel.ready.then(() => {
				//let array = Object.getOwnPropertyNames(session);
				//console.log(array);

				// Setup for ipywidgets
				let jupyter_area = document.createElement('div');
				let widget_text = document.createTextNode("Hierunter sollte das Widget stehen");
				jupyter_area.appendChild(widget_text);
        	        	let input_area = document.createElement('div');
                		let widget_area = document.createElement('div');
             	   		input_area.setAttribute("class", "inputarea");
                		widget_area.setAttribute("class", "widgetarea");
                		jupyter_area.appendChild(input_area);
				jupyter_area.appendChild(widget_area);
				widget.node.appendChild(jupyter_area);
				//widget_area.appendChild(document.createTextNode("Widget-Bereich"));



				let widget_code =
`from ipywidgets import IntSlider, Text, VBox
from IPython.display import display

s = IntSlider(max=200, value=100)
t = Text()

def update_text(change=None):
    t.value = str(s.value ** 2)

s.observe(update_text, names='value')
update_text()
display(VBox([s, t]));`
				//let inputarea = document.getElementsByClassName('inputarea')[0] as HTMLElement;
				let editor = CodeMirror(input_area, {
                    			value: widget_code,
                    			mode: 'python',
                    			tabSize: 4,
                    			showCursorWhenSelecting: true,
                    			viewportMargin: Infinity,
                    			readOnly: true
					});
				console.log(editor);
				//let widgetarea = document.getElementsByClassName("widgetarea")[0] as HTMLElement;
					console.log(widget_area);
					let manager = new WidgetManager(session.kernel, widget_area);
					console.log(manager);


					/*	let widget_request = session.kernel.requestExecute({ code: widget_code });
                		widget_request.onIOPub = (msg:any) => {
				// If we have a display message, display the widget.
					console.log("WIDGET ACTIVATED");
					console.log(msg);
					//if(msg.content.type == 'display_data'){
					//	manager.display_view(msg, 
					};*/

					let execution = session.kernel.requestExecute({ code: widget_code });
        execution.onIOPub = (msg:any) => {
            // If we have a display message, display the widget.
            if (KernelMessage.isDisplayDataMsg(msg)) {
                let widgetData: any = msg.content.data['application/vnd.jupyter.widget-view+json'];
                if (widgetData !== undefined && widgetData.version_major === 2) {
			console.log("Trying to build model");	
			let model = manager.get_model(widgetData.model_id);
			console.log(model);
			//console.log(model.get('_view_name');
			//console.log(manager.loadClass(model.get('_view_name'), model.get('_view_module'), model.get('_view_module_version'));
		    if (model !== undefined) {
		    	//@ts-ignore
			model.then(model => {
				console.log(model.get('_view_name'));
				console.log("In here");
				console.log(manager.create_view(model));
				let view = manager.create_view(model);
				console.log(view);
				view.then(view => {
				//manager.display_view(msg, view, {});
				//return Promise.resolve(view).then((view) => {Widget.attach(view, this.el);});
				});
				//manager.display_model(msg, model);
				console.log("Afterwards");
                        });
                    }
                }
            }
};

				session.kernel.registerCommTarget('test2', (comm:any, commMsg:any):any => {
					if(commMsg.content.target_name !== 'test2'){
						return;
					}
					comm.onMsg = (msg:any) => {
						var c = msg.buffers[0].buffer;
						c;
						console.log("Message received");
						//console.log(c[0]);
						//console.log("MEEESSSAAAGGEEE ", msg.buffers[0]);
						//console.log(new Float32Array(msg.buffers[0].buffer));
					};
					comm.onClose = (msg:any) => {};
				});

				// Initialize function that returns variable list
				let code: string;
				/*fetch('packages/python/test.py').then(response => {
					console.log("Reading code: ", response)
					return response.json();
				}).then(data => {
					code = data;
					});*/

				code = 
`import json
from IPython.core.magics.namespace import NamespaceMagics
from IPython import get_ipython
#from neo.core import BaseNeo
nsm = NamespaceMagics()
nsm.shell = get_ipython().kernel.shell

def testfunc():
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    from neo.core.baseneo import BaseNeo
    from neo.core.block import Block
    vals = nsm.who_ls()
    values = [v for v in vals if isinstance(eval(v), (BaseNeo, list))] # in ['Block', 'Segment', 'ChannelIndex', 
    for value in list(values):
        val = eval(value)
        if isinstance(val, list):
            if len(val) > 0 and isinstance(val[0], BaseNeo):
                    pass
            else:
                values.remove(value)
        if isinstance(val, Block):
            for i, seg in enumerate(val.list_children_by_class("Segment")):
                #globals()[''.join(['blchidx', str(i)])] = chidx
                values.append(''.join([value, '.segmets[', str(i), ']']))
                for j, sig in enumerate(seg.analogsignals):
                    #pass
                    values.append(''.join([values[-1-j], '.analogsigs[', str(j), ']']))

    return json.dumps(values)`
				
				console.log('Python Code: ', code);
				let request_init: KernelMessage.IExecuteRequest = {
					code: code,
					stop_on_error: false,
					store_history: false,
				};
				session.kernel.requestExecute(request_init);

				// React to codecell execution, update variable list
				NotebookActions.executed.connect(() => {

					console.log("Cell executed"); 

					let request: KernelMessage.IExecuteRequest = {
						code: "print(testfunc())",
						stop_on_error: false,
						store_history: false,
					};

					let future: Kernel.IFuture = session.kernel.requestExecute(request);

					future.onIOPub = ( ( msg: KernelMessage.IIOPubMessage ) =>
						{ ioCallback( msg );});

				});

			});});
			
			console.log("Connected to currently active Notebook");
		
		});

		// Adding content to my tab
		let new_content = document.createElement('div');
		let text = document.createTextNode("This a text.");
		new_content.appendChild(text);
		widget.node.appendChild(new_content);

		const command: string = 'neo:open';

		app.commands.addCommand(command, {
			label: 'Visualize neo and elephant',
			execute: () => {
				if (!widget.isAttached) {
					app.shell.addToMainArea(widget);
				}
				app.shell.activateById(widget.id);
			}
		});

		palette.addItem({command, category: 'Tutorial'});

	}
};

//function add_text(text: string, parent_elem: any){
	//let new_content = document.createElement('div');
//}

export default extension;
