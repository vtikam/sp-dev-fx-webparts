import * as React from 'react';
import styles from './TeamsMembershipUpdater.module.scss';
import { ITeamsMembershipUpdaterProps } from './ITeamsMembershipUpdaterProps';
import { DetailsList, DetailsListLayoutMode, IColumn, SelectionMode, ProgressIndicator, Separator, PrimaryButton, MessageBar, MessageBarType, Link, Toggle, List, Dropdown, IDropdownOption, Text, TeachingBubble, Icon, Callout, mergeStyleSets, FontWeights } from 'office-ui-fabric-react';
import { ITeamsMembershipUpdaterWebPartProps } from '../TeamsMembershipUpdaterWebPart';
import { readString } from 'react-papaparse';
import { MSGraphClient, SPHttpClient, SPHttpClientResponse } from '@microsoft/sp-http';
import * as MicrosoftGraph from "@microsoft/microsoft-graph-types";
import { FilePicker, IFilePickerResult } from '@pnp/spfx-controls-react';
import * as strings from 'TeamsMembershipUpdaterWebPartStrings';
import { emailColumnPlaceholder, selectTeamPlacehold } from 'TeamsMembershipUpdaterWebPartStrings';

export enum Stage {
  LoadingTeams,
  CheckingOwnership,
  LoadingCurrentMembers,
  ComparingMembers,
  RemovingOrphendMembers,
  AddingNewMembers,
  LoggingDone,
  Done,
  ErrorOwnership,
  Ready
}

export interface ITeamsMembershipUpdaterState {
  items: IDropdownOption[];
  selectionDetails: IDropdownOption;
  csvdata: any[];
  csvcolumns: IColumn[];
  csvSelected: IDropdownOption;
  csvItems: IDropdownOption[];
  me: string;
  groupOwners: string[];
  groupMembers: Array<MicrosoftGraph.User>;
  stage: Stage;
  logs: Array<string>;
  errors: Array<string>;
  logurl: string;
  delete: boolean;
  orphanedMembersHelp: boolean;
}

export interface IRequest {
  requests: any[];
}

export default class TeamsMembershipUpdater extends React.Component<ITeamsMembershipUpdaterProps, ITeamsMembershipUpdaterState> {
  private _datacolumns: IColumn[];
  private _data: any[];

  constructor(props: ITeamsMembershipUpdaterWebPartProps) {
    super(props);

    this.state = {
      items: props.items,
      selectionDetails: null,
      csvdata: null,
      csvcolumns: [],
      csvSelected: null,
      csvItems: [],
      me: null,
      groupOwners: [],
      groupMembers: [],
      stage: Stage.LoadingTeams,
      logs: [],
      errors: [],
      logurl: null,
      delete: true,
      orphanedMembersHelp: false
    };
  }

  public addError = (e: string, o: any): void => {
    console.error(e, o);
    let _log: Array<string> = this.state.errors;
    _log.push(e);
    this.setState({ ...this.state, errors: _log });
  }

  public addLog = (e: string): void => {
    let _log: Array<string> = this.state.logs;
    _log.push(e);
    this.setState({ ...this.state, logs: _log });
  }

  public handleOnDrop = (data) => {
    var h = data[0].meta.fields;
    this._data = data.map(r => { return r.data; });
    this._datacolumns = h.map(r => { return { key: r.replace(' ', ''), name: r, fieldName: r, isResizable: true }; });
    this.setState({ ...this.state, csvcolumns: this._datacolumns, csvdata: this._data, csvItems: h.map(r => { return { key: r.replace(' ', ''), text: r }; }), logs: [], errors: [], logurl: null });
  }

  public handleOnError = (err, file, inputElem, reason) => {
    console.error(err);
  }

  public handleOnRemoveFile = (data) => {
    this._data = null;
    this.setState({ ...this.state, csvdata: null });
  }

  private fileChange = (filePickerResult: IFilePickerResult) => {
    this.props.context.msGraphClientFactory.getClient().then((client: MSGraphClient): void => {
      filePickerResult.downloadFileContent().then((file) => {
        const reader = new FileReader();
        console.log(file);
        reader.readAsArrayBuffer(file);
        reader.onloadend = ((ev) => {
          let decodedString = new TextDecoder('utf-8').decode(new DataView(reader.result as ArrayBuffer));
          const csv = readString(decodedString, { header: true, skipEmptyLines: true });
          var h = csv.meta.fields;
          this._data = csv.data;
          this._datacolumns = h.map(r => { return { key: r.replace(' ', ''), name: r, fieldName: r, isResizable: true }; });
          this.setState({ ...this.state, csvcolumns: this._datacolumns, csvdata: this._data, csvItems: h.map(r => { return { key: r.replace(' ', ''), text: r }; }), logs: [], errors: [], logurl: null });
        });
      });
    });
  }

  public onChange = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption): void => {
    this.setState({ ...this.state, stage: Stage.CheckingOwnership, logs: [], errors: [], logurl: null });
    this.props.context.msGraphClientFactory.getClient().then((client: MSGraphClient): void => {
      client.api(`groups/${item.key}/owners`).version("v1.0").get((err, res) => {
        if (err) {
          this.addError(err.message, err);
          return;
        }
        let _owners: Array<string> = new Array<string>();
        let b: boolean = false;
        res.value.forEach(element => {
          _owners.push(element.userPrincipalName);
          if (element.userPrincipalName == this.state.me) b = true;
        });
        if (b) this.setState({ ...this.state, selectionDetails: item, groupOwners: _owners, stage: Stage.Ready });
        else this.setState({ ...this.state, stage: Stage.ErrorOwnership });
      });
    });
  }

  public onEmailChange = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption): void => {
    this.setState({ ...this.state, csvSelected: item });
  }

  public onToggleDelete = (ev: React.MouseEvent<HTMLElement>, checked: boolean): void => {
    this.setState({ ...this.state, delete: checked });
  }

  public onRun = (e) => {
    this.setState({ ...this.state, stage: Stage.LoadingCurrentMembers });
    this.props.context.msGraphClientFactory.getClient().then((client: MSGraphClient): void => {
      client.api(`groups/${this.state.selectionDetails.key}/members`).version("v1.0").get(async (err, res) => {
        if (err) {
          this.addError(err.message, err);
          return;
        }

        let _members: Array<MicrosoftGraph.User> = res.value;
        this.setState({ ...this.state, groupMembers: _members, stage: Stage.ComparingMembers });

        this.addLog(`Found ${_members.length} members existing in the group`);

        let _delete: Array<MicrosoftGraph.User> = new Array<MicrosoftGraph.User>();

        _members = _members.filter(m => {
          if (this._data.some(value => value[this.state.csvSelected.text] === m.mail) || this.state.groupOwners.some(value => value === m.userPrincipalName)) return m;
          else { if (this.state.delete == true) { _delete.push(m); this.addLog(`Will delete ${m.mail}`); } }
        });

        let reqs: IRequest[] = [];
        if (this.state.delete == true) {
          this.setState({ ...this.state, stage: Stage.RemovingOrphendMembers });
          let _i, _j, _k, temparray, chunk = 20;
          for (_i = 0, _j = _delete.length, _k = 0; _i < _j; _i += chunk) {
            temparray = _delete.slice(_i, _i + chunk);
            reqs.push({ requests: temparray.map(e1 => { _k++; return { id: `${_k}`, method: "DELETE", url: `groups/${this.state.selectionDetails.key}/members/${e1.id}/$ref` }; }) });
          }
        }

        let newMembers: string[] = [];

        this._data.forEach(async e2 => {
          if (_members.some(m => m.mail === e2[this.state.csvSelected.text]) == false) {
            newMembers.push(e2[this.state.csvSelected.text]);
            this.addLog(`Will add ${e2[this.state.csvSelected.text]}`);
          }
        });

        if (reqs.length > 0) {
          this.addLog(`${reqs.length} Delete Batches Detected`);
          reqs.forEach(r => {
            if (r.requests.length > 0) {
              this.addLog(`Deleting ${r.requests.length} users as a batch`);
              client.api("$batch").version("v1.0").post(r, (er, re) => {
                if (err) { this.addError(err.message, err); return; }
                if (re) re.reponses.forEach(e3 => { if (e3.body.error) this.addError(e3.body.error.message, e3.body.error); });
                this.addLog(`Deleting Batch Done`);
              });
            }
          });
          if (newMembers.length == 0) this.Done();
          else this.addMembers(newMembers, client);
        }
        else if (newMembers.length == 0) this.Done();
        else this.addMembers(newMembers, client);
      });
    });
  }

  public Done = (): void => {
    this.setState({ ...this.state, stage: this.props.loglist !== null || this.props.loglist !== undefined ? Stage.LoggingDone : Stage.Done });
    if (this.props.loglist !== null || this.props.loglist !== undefined) {
      //If Log list provided place the log entries into the list
      this.props.context.spHttpClient.get(`${this.props.context.pageContext.web.absoluteUrl}/_api/web/lists/GetByTitle('${this.props.loglist.title}')?$select=ListItemEntityTypeFullName`, SPHttpClient.configurations.v1)
        .then((res: SPHttpClientResponse): Promise<{ ListItemEntityTypeFullName: string; }> => {
          return res.json();
        })
        .then((web: { ListItemEntityTypeFullName: string }): void => {
          const p = {
            //"__metadata": { "type": web.ListItemEntityTypeFullName },
            "Title": `${this.state.selectionDetails.text} update ${new Date().toString()}`,
            "Logs": this.state.logs.join(", \n"),
            "Errors": this.state.errors.join(", \n")
          };

          this.props.context.spHttpClient.post(`${this.props.context.pageContext.web.absoluteUrl}/_api/web/lists/GetByTitle('${this.props.loglist.title}')/items`, SPHttpClient.configurations.v1, {
            body: JSON.stringify(p)
          }).then((res: SPHttpClientResponse): Promise<{ w: any; }> => {
            return res.json();
          }).then((w: any): void => {
              this.setState({ ...this.state, stage: Stage.Done, logurl: `${this.props.loglist.url}/my.aspx` });
          });
        });
    }
  }

  public addMembers = (newMembers: string[], client: MSGraphClient): void => {
    this.setState({ ...this.state, stage: Stage.AddingNewMembers });
    let reqs: IRequest[] = [];
    let _i, _j, _k, temparray, chunk = 20;
    for (_i = 0, _j = newMembers.length, _k = 0; _i < _j; _i += chunk) {
      temparray = newMembers.slice(_i, _i + chunk);
      reqs.push({ requests: temparray.map(e => { _k++; return { id: `${_k}`, method: "GET", url: `users/${e}?$select=id` }; }) });
    }

    this.addLog(`Getting Object IDs for ${newMembers.length} Members to Add from Graph`);
    for (let i = 0; i < reqs.length; i++) {
      console.log("Starting batch job " + i);
      console.log(reqs[i]);
      client.api("$batch").version("v1.0").post(reqs[i], (er, re) => {
        console.log(re);
        if (er) { this.addError(er.message, er); return; }
        let newreq: IRequest = { requests: [] };
        if (re) {
          re.responses.forEach(e => {
            if (e.body.error) this.addError(e.body.error.message, e.body.error);
            else {
              newreq.requests.push({
                id: `${newreq.requests.length + 1}`,
                method: "POST",
                url: `groups/${this.state.selectionDetails.key}/members/$ref`,
                headers: { "Content-Type": "application/json" },
                body: { "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${e.body.id}` }
              });
            }
          });
          console.log("Adding");
          this.addLog(`Adding ${newreq.requests.length} Members`);
          client.api("$batch").version("v1.0").post(newreq, (err, res) => {
            if (err) { this.addError(err.message, err); return; }
            if (res) {
              res.responses.forEach(e => {
                if (e.body.error) this.addError(e.body.error.message, e.body.error);
              });
              this.addLog("Adding Done");
              this.Done();
            }
            this.addLog("Adding Done");
            this.Done();
          });
        }
      });

    }

  }

  public componentDidMount(): void {
    this.props.context.msGraphClientFactory.getClient().then((client: MSGraphClient): void => {
      let req = {
        requests: [
          { id: "1", method: "GET", url: "me" },
          { id: "2", method: "GET", url: "me/joinedTeams" }
        ]
      };
      client.api("$batch").version("v1.0").post(req, (err, res) => {
        if (err) {
          this.addError(err.message, err);
          return;
        }
        let teams: Array<IDropdownOption> = res.responses[1].body.value.map((item: any) => {
          return { key: item.id, text: item.displayName };
        });
        this.setState({ ...this.state, me: res.responses[0].body.userPrincipalName, items: teams, stage: Stage.Ready });

      });
    });
  }

  public render(): React.ReactElement<ITeamsMembershipUpdaterProps> {
    const { items, csvItems, orphanedMembersHelp, csvdata, csvcolumns, stage, csvSelected, logurl, logs, errors } = this.state;
    const mg = mergeStyleSets({
      callout: {
        width: 320,
        padding: '20px 24px',
      },
      title: {
        marginBottom: 12,
        fontWeight: FontWeights.semilight,
      }
    });
    return (
      <div className={styles.teamsMembershipUpdater}>
        <div className={styles.container}>
          <Text variant="xLarge">{this.props.title}</Text>
          {stage == Stage.Done && <MessageBar messageBarType={MessageBarType.success} isMultiline={false}>
              {strings.doneText}
            {logurl != null && <Link href={logurl}>{strings.doneHistory}</Link>}
          </MessageBar>}
          {stage == Stage.LoadingTeams && <ProgressIndicator label={strings.loadingTeams} description={strings.loadingTeamsDescription} />}
          {stage == Stage.LoadingCurrentMembers && <ProgressIndicator label={strings.loadingMembersLabel} description={strings.loadingMembersDescription} />}
          {stage == Stage.ComparingMembers && <ProgressIndicator label={strings.comparingMembers} description={strings.comparingMembersDescription} />}
          {stage == Stage.RemovingOrphendMembers && <ProgressIndicator label={strings.removingOrphend} description={strings.removingOrphendDescription} />}
          {stage == Stage.AddingNewMembers && <ProgressIndicator label={strings.addingNew} description={strings.addingNewDescription} />}
          {stage == Stage.LoggingDone && <ProgressIndicator label={strings.logging} description={strings.loggingDescription} />}
          <Dropdown label={strings.selectTeam} onChange={this.onChange} placeholder={selectTeamPlacehold} options={items} disabled={items.length == 0} />
          {stage == Stage.CheckingOwnership && <ProgressIndicator label={strings.checkingOwner} description={strings.checkingOwnerDescription} />}
          {stage == Stage.ErrorOwnership && <MessageBar messageBarType={MessageBarType.error} isMultiline={false}>You are not an owner of this group. Please select another.</MessageBar>}
          <FilePicker accepts={[".csv"]} buttonLabel={strings.selectFile} buttonIcon="ExcelDocument" label={strings.selectFileLabel}
            hideStockImages hideOrganisationalAssetTab hideSiteFilesTab hideWebSearchTab hideLinkUploadTab onSave={this.fileChange} onChange={this.fileChange} context={this.props.context} />
          <Dropdown label={strings.emailColumn} onChange={this.onEmailChange} placeholder={emailColumnPlaceholder} options={csvItems} disabled={!csvdata} />
          <Toggle label={<span>4. Remove Orphaned Members <Icon iconName="Info" onMouseEnter={() => this.setState({...this.state, orphanedMembersHelp: true})} id="orphanedMembers" /></span>} inlineLabel onText={strings.on} offText={strings.off} defaultChecked={true} onChange={this.onToggleDelete} />
          {orphanedMembersHelp && <Callout target="#orphanedMembers" className={mg.callout} onDismiss={() => this.setState({...this.state, orphanedMembersHelp: false})}>
            <Text block variant="xLarge" className={mg.title}>{strings.orphanedMembersTitle}</Text>
            {strings.orphanedMembersContent}
          </Callout>}
          <PrimaryButton text={strings.submitButton} onClick={this.onRun} allowDisabledFocus disabled={!csvdata || items.length == 0 || stage != Stage.Ready || !csvSelected} />

          <Separator>CSV Preview</Separator>
          {csvdata && <DetailsList
            items={csvdata}
            columns={csvcolumns}
            setKey="set"
            layoutMode={DetailsListLayoutMode.justified}
            selectionMode={SelectionMode.none}
          />}
          {logs.length > 0 && (<><Separator>Logs</Separator><List items={logs} onRenderCell={this._onRenderCell} /></>)}
          {errors.length > 0 && (<><Separator>Errors</Separator><List items={errors} onRenderCell={this._onRenderCell} /></>)}
        </div>
      </div>
    );
  }

  private _onRenderCell = (item: any, index: number | undefined): JSX.Element => {
    return (
      <div data-is-focusable={true}>
        <div style={{ padding: 2 }}>
          {item}
        </div>
      </div>
    );
  }
}
